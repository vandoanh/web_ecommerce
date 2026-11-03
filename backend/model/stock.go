package model

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
)

var stockIdempotencyKeyPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// errStockIdempotencyRace asks the caller to retry once after a concurrent
// request with the same idempotency key won the unique-index race.
var errStockIdempotencyRace = errors.New("stock adjustment idempotency race")

func applyStockDelta(stock, delta int64) (int64, error) {
	if delta == 0 {
		return stock, repository.ErrInvalidStockAdjustment
	}
	if delta > math.MaxInt32 || delta < math.MinInt32 {
		return stock, repository.ErrStockOverflow
	}
	next := stock + delta
	if next < 0 {
		return stock, repository.ErrInsufficientStock
	}
	if next > math.MaxInt32 {
		return stock, repository.ErrStockOverflow
	}
	return next, nil
}

func stockAdjustmentRequestHash(productID, delta int64, reason string) (string, error) {
	canonical := struct {
		ProductID int64  `json:"productId"`
		Delta     int64  `json:"delta"`
		Reason    string `json:"reason"`
	}{ProductID: productID, Delta: delta, Reason: reason}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:]), nil
}

// AdjustProductStock applies a signed stock delta and records an immutable
// stock_adjustments audit row in the same transaction. The audit table covers
// admin adjustments only; checkout reservations and cancellation restorations
// are recorded on the order and intentionally do not write here. A supplied
// idempotency key replays the original request identity but reports the
// product's live stock/version.
func (m *StoreModel) AdjustProductStock(ctx context.Context, productID, actorUserID int64, input data.StockAdjustmentInput) (data.StockAdjustmentResult, error) {
	reason := strings.TrimSpace(input.Reason)
	if productID < 1 || actorUserID < 1 || input.Delta == 0 || reason == "" || utf8.RuneCountInString(reason) > productReasonMaxRunes {
		return data.StockAdjustmentResult{}, repository.ErrInvalidStockAdjustment
	}
	key := strings.ToLower(strings.TrimSpace(input.IdempotencyKey))
	if key != "" && !stockIdempotencyKeyPattern.MatchString(key) {
		return data.StockAdjustmentResult{}, repository.ErrInvalidStockAdjustment
	}
	hash, err := stockAdjustmentRequestHash(productID, input.Delta, reason)
	if err != nil {
		return data.StockAdjustmentResult{}, err
	}

	// A retry after a same-key insert race observes the winning audit row and
	// either replays it (identical request) or reports a conflict.
	for attempt := 0; attempt < 2; attempt++ {
		result, err := m.adjustProductStockOnce(ctx, productID, actorUserID, input.Delta, reason, key, hash)
		if errors.Is(err, errStockIdempotencyRace) && attempt == 0 {
			continue
		}
		return result, err
	}
	return data.StockAdjustmentResult{}, repository.ErrStockIdempotencyConflict
}

func (m *StoreModel) adjustProductStockOnce(ctx context.Context, productID, actorUserID, delta int64, reason, key, hash string) (data.StockAdjustmentResult, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return data.StockAdjustmentResult{}, err
	}
	defer tx.Rollback()

	if key != "" {
		var existingProductID, existingDelta int64
		var existingHash string
		err = tx.QueryRowContext(ctx,
			`SELECT product_id, delta, request_hash FROM stock_adjustments WHERE actor_user_id = ? AND idempotency_key = ? FOR UPDATE`,
			actorUserID, key).
			Scan(&existingProductID, &existingDelta, &existingHash)
		switch {
		case err == nil:
			if existingProductID != productID || existingDelta != delta || existingHash != hash {
				return data.StockAdjustmentResult{}, repository.ErrStockIdempotencyConflict
			}
			// A replay must not present the original stock_after value as the
			// current quantity: checkout, cancellation or another admin
			// adjustment may have changed inventory since then. Lock and read
			// the live product row instead.
			var currentStock int
			var currentVersion int64
			err = tx.QueryRowContext(ctx, `SELECT stock, stock_version FROM products WHERE id = ? FOR UPDATE`, productID).
				Scan(&currentStock, &currentVersion)
			if errors.Is(err, sql.ErrNoRows) {
				return data.StockAdjustmentResult{}, repository.ErrProductNotFound
			}
			if err != nil {
				return data.StockAdjustmentResult{}, err
			}
			if err = tx.Commit(); err != nil {
				return data.StockAdjustmentResult{}, err
			}
			return data.StockAdjustmentResult{
				ProductID:    existingProductID,
				Stock:        currentStock,
				StockVersion: currentVersion,
				Replayed:     true,
			}, nil
		case !errors.Is(err, sql.ErrNoRows):
			return data.StockAdjustmentResult{}, err
		}
	}

	var stock int
	var stockVersion int64
	err = tx.QueryRowContext(ctx, `SELECT stock, stock_version FROM products WHERE id = ? FOR UPDATE`, productID).
		Scan(&stock, &stockVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return data.StockAdjustmentResult{}, repository.ErrProductNotFound
	}
	if err != nil {
		return data.StockAdjustmentResult{}, err
	}
	nextStock, err := applyStockDelta(int64(stock), delta)
	if err != nil {
		return data.StockAdjustmentResult{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE products SET stock = ?, stock_version = stock_version + 1 WHERE id = ?`, int(nextStock), productID); err != nil {
		return data.StockAdjustmentResult{}, err
	}
	var idempotencyKey any
	if key != "" {
		idempotencyKey = key
	}
	_, err = tx.ExecContext(ctx,
		`INSERT INTO stock_adjustments (product_id, delta, stock_before, stock_after, stock_version_after, reason, actor_user_id, idempotency_key, request_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
		productID, delta, stock, int(nextStock), stockVersion+1, reason, actorUserID, idempotencyKey, hash)
	if err != nil {
		if key != "" && isDuplicateKeyError(err) {
			return data.StockAdjustmentResult{}, errStockIdempotencyRace
		}
		return data.StockAdjustmentResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return data.StockAdjustmentResult{}, err
	}
	return data.StockAdjustmentResult{ProductID: productID, Stock: int(nextStock), StockVersion: stockVersion + 1}, nil
}
