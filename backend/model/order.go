package model

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
)

// ErrProductUnavailable is kept as a model-level alias for callers that used
// the original package-level error before it moved to the repository contract.
var ErrProductUnavailable = repository.ErrProductUnavailable

type orderQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

const orderSelectColumns = `o.id, o.order_number, o.user_id, u.username, o.total_vnd, o.status, o.payment_method, o.recipient_name, o.phone, o.shipping_address, o.created_at`

// CreateOrder creates an order transactionally. A non-empty idempotency key is
// scoped to the customer and replays the previously created order when the
// canonical request payload matches.
func (m *StoreModel) CreateOrder(ctx context.Context, userID int64, key string, input data.CreateOrderInput) (data.Order, bool, error) {
	if err := validateOrderInput(input); err != nil {
		return data.Order{}, false, err
	}
	key = strings.ToLower(strings.TrimSpace(key))
	hash, err := orderRequestHash(input)
	if err != nil {
		return data.Order{}, false, err
	}
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return data.Order{}, false, err
	}
	defer tx.Rollback()

	if key != "" {
		if _, err = tx.ExecContext(ctx, `INSERT INTO order_idempotency (user_id, idempotency_key, request_hash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE idempotency_key = VALUES(idempotency_key)`, userID, key, hash); err != nil {
			return data.Order{}, false, fmt.Errorf("reserve idempotency key: %w", err)
		}
		var existingHash string
		var existingOrderID sql.NullInt64
		if err = tx.QueryRowContext(ctx, `SELECT request_hash, order_id FROM order_idempotency WHERE user_id = ? AND idempotency_key = ? FOR UPDATE`, userID, key).Scan(&existingHash, &existingOrderID); err != nil {
			return data.Order{}, false, fmt.Errorf("load idempotency key: %w", err)
		}
		if existingHash != hash {
			return data.Order{}, false, repository.ErrIdempotencyConflict
		}
		if existingOrderID.Valid && existingOrderID.Int64 > 0 {
			order, loadErr := loadOrder(ctx, tx, existingOrderID.Int64, 0)
			if loadErr != nil {
				return data.Order{}, false, loadErr
			}
			if err = tx.Commit(); err != nil {
				return data.Order{}, false, err
			}
			return order, true, nil
		}
	}

	// Capture one instant for every scheduled-price decision in this checkout.
	effectiveAt := time.Now().UTC()
	order, err := m.insertOrder(ctx, tx, userID, key, input, effectiveAt)
	if err != nil {
		return data.Order{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return data.Order{}, false, err
	}
	return order, false, nil
}

func validateOrderInput(input data.CreateOrderInput) error {
	if len(input.Items) == 0 || len(input.Items) > 100 {
		return repository.ErrInvalidOrderInput
	}
	seen := make(map[int64]struct{}, len(input.Items))
	for _, line := range input.Items {
		if line.ProductID < 1 || line.Quantity < 1 || line.Quantity > 99 {
			return repository.ErrInvalidOrderInput
		}
		if _, exists := seen[line.ProductID]; exists {
			return repository.ErrDuplicateOrderProduct
		}
		seen[line.ProductID] = struct{}{}
	}
	return nil
}

func (m *StoreModel) insertOrder(ctx context.Context, tx *sql.Tx, userID int64, key string, input data.CreateOrderInput, effectiveAt time.Time) (data.Order, error) {
	type lockedProduct struct {
		name  string
		price int64
		stock int
	}
	lines := append([]data.OrderLineInput(nil), input.Items...)
	// Lock in ascending product ID order so concurrent checkouts cannot deadlock
	// each other by acquiring the same rows in opposite order.
	sort.Slice(lines, func(i, j int) bool { return lines[i].ProductID < lines[j].ProductID })
	locked := make(map[int64]lockedProduct, len(lines))
	for _, line := range lines {
		var product lockedProduct
		var regularPrice int64
		var discountPrice sql.NullInt64
		var startsAt, endsAt sql.NullTime
		err := tx.QueryRowContext(ctx, `SELECT name, COALESCE(regular_price_vnd, price_vnd), discount_price_vnd, discount_starts_at, discount_ends_at, stock FROM products WHERE id = ? AND is_active = TRUE FOR UPDATE`, line.ProductID).
			Scan(&product.name, &regularPrice, &discountPrice, &startsAt, &endsAt, &product.stock)
		if errors.Is(err, sql.ErrNoRows) {
			return data.Order{}, repository.ErrProductUnavailable
		}
		if err != nil {
			return data.Order{}, fmt.Errorf("lock product %d: %w", line.ProductID, err)
		}
		var discount *int64
		if discountPrice.Valid {
			value := discountPrice.Int64
			discount = &value
		}
		var starts, ends *time.Time
		if startsAt.Valid {
			value := startsAt.Time.UTC()
			starts = &value
		}
		if endsAt.Valid {
			value := endsAt.Time.UTC()
			ends = &value
		}
		product.price = data.EffectiveProductPriceVND(regularPrice, discount, starts, ends, effectiveAt)
		if product.price <= 0 || product.price > math.MaxInt64/int64(line.Quantity) {
			return data.Order{}, repository.ErrInvalidOrderInput
		}
		if product.stock < line.Quantity {
			return data.Order{}, repository.ErrProductUnavailable
		}
		locked[line.ProductID] = product
	}
	// Checkout reservations deliberately do not write stock_adjustments: that
	// table is the admin-adjustment audit trail. The order_items snapshot and
	// order status are the durable record of this inventory movement; only the
	// product row's stock and stock_version change here.
	for _, line := range lines {
		result, err := tx.ExecContext(ctx, `UPDATE products SET stock = stock - ?, stock_version = stock_version + 1 WHERE id = ? AND stock >= ?`, line.Quantity, line.ProductID, line.Quantity)
		if err != nil {
			return data.Order{}, fmt.Errorf("reserve product %d: %w", line.ProductID, err)
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return data.Order{}, err
		}
		if changed != 1 {
			return data.Order{}, repository.ErrProductUnavailable
		}
	}

	order := data.Order{
		UserID:          userID,
		Status:          data.OrderStatusPending,
		PaymentMethod:   "cod",
		RecipientName:   input.RecipientName,
		Phone:           input.Phone,
		ShippingAddress: input.ShippingAddress,
		Items:           make([]data.OrderItem, 0, len(input.Items)),
	}
	for _, line := range input.Items {
		product := locked[line.ProductID]
		lineTotal := product.price * int64(line.Quantity)
		if order.TotalVND > math.MaxInt64-lineTotal {
			return data.Order{}, repository.ErrInvalidOrderInput
		}
		order.TotalVND += lineTotal
		order.Items = append(order.Items, data.OrderItem{
			ProductID:    line.ProductID,
			ProductName:  product.name,
			Quantity:     line.Quantity,
			UnitPriceVND: product.price,
		})
	}
	orderNumber, err := newOrderNumber()
	if err != nil {
		return data.Order{}, err
	}
	order.OrderNumber = orderNumber
	result, err := tx.ExecContext(ctx, `INSERT INTO orders (order_number, user_id, total_vnd, status, payment_method, recipient_name, phone, shipping_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		order.OrderNumber, order.UserID, order.TotalVND, order.Status, order.PaymentMethod, order.RecipientName, order.Phone, order.ShippingAddress)
	if err != nil {
		return data.Order{}, fmt.Errorf("insert order: %w", err)
	}
	order.ID, err = result.LastInsertId()
	if err != nil {
		return data.Order{}, err
	}
	if key != "" {
		result, err = tx.ExecContext(ctx, `UPDATE order_idempotency SET order_id = ? WHERE user_id = ? AND idempotency_key = ?`, order.ID, userID, key)
		if err != nil {
			return data.Order{}, fmt.Errorf("link idempotency key: %w", err)
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return data.Order{}, err
		}
		if changed != 1 {
			return data.Order{}, errors.New("idempotency reservation disappeared")
		}
	}
	for _, item := range order.Items {
		if _, err = tx.ExecContext(ctx, `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_vnd) VALUES (?, ?, ?, ?, ?)`, order.ID, item.ProductID, item.ProductName, item.Quantity, item.UnitPriceVND); err != nil {
			return data.Order{}, fmt.Errorf("insert order item: %w", err)
		}
	}
	return loadOrder(ctx, tx, order.ID, 0)
}

func newOrderNumber() (string, error) {
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("generate order number: %w", err)
	}
	return "ORD-" + strings.ToUpper(hex.EncodeToString(random)), nil
}

func orderRequestHash(input data.CreateOrderInput) (string, error) {
	canonical := input
	canonical.Items = append([]data.OrderLineInput(nil), input.Items...)
	sort.Slice(canonical.Items, func(i, j int) bool { return canonical.Items[i].ProductID < canonical.Items[j].ProductID })
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:]), nil
}

// ListOrders returns a customer-scoped page of orders.
func (m *StoreModel) ListOrders(ctx context.Context, userID int64, page, pageSize int) ([]data.Order, int64, error) {
	return m.listOrders(ctx, userID, page, pageSize, data.OrderFilter{})
}

// AdminOrders is kept as a convenience for callers that only need pagination.
func (m *StoreModel) AdminOrders(ctx context.Context, page, pageSize int) ([]data.Order, int64, error) {
	return m.AdminOrdersFiltered(ctx, page, pageSize, data.OrderFilter{})
}

// AdminOrdersFiltered returns all orders with optional status and text filters.
func (m *StoreModel) AdminOrdersFiltered(ctx context.Context, page, pageSize int, filter data.OrderFilter) ([]data.Order, int64, error) {
	return m.listOrders(ctx, 0, page, pageSize, filter)
}

func (m *StoreModel) listOrders(ctx context.Context, userID int64, page, pageSize int, filter data.OrderFilter) ([]data.Order, int64, error) {
	if page < 1 || pageSize < 1 || pageSize > 100 {
		return nil, 0, repository.ErrInvalidOrderInput
	}
	if page > math.MaxInt/pageSize {
		return nil, 0, repository.ErrInvalidOrderInput
	}
	where, args, err := orderWhere(userID, filter)
	if err != nil {
		return nil, 0, err
	}
	var total int64
	if err = m.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM orders o JOIN users u ON u.id = o.user_id`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	query := `SELECT ` + orderSelectColumns + ` FROM orders o JOIN users u ON u.id = o.user_id` + where + ` ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := m.db.QueryContext(ctx, query, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	orders := []data.Order{}
	for rows.Next() {
		var order data.Order
		if err := rows.Scan(&order.ID, &order.OrderNumber, &order.UserID, &order.CustomerName, &order.TotalVND, &order.Status, &order.PaymentMethod, &order.RecipientName, &order.Phone, &order.ShippingAddress, &order.CreatedAt); err != nil {
			return nil, 0, err
		}
		order.Items = []data.OrderItem{}
		orders = append(orders, order)
	}
	if err = rows.Err(); err != nil {
		return nil, 0, err
	}
	rows.Close()
	for i := range orders {
		if err = loadOrderItems(ctx, m.db, &orders[i]); err != nil {
			return nil, 0, err
		}
	}
	return orders, total, nil
}

func orderWhere(userID int64, filter data.OrderFilter) (string, []any, error) {
	conditions := []string{}
	args := []any{}
	if userID > 0 {
		conditions = append(conditions, `o.user_id = ?`)
		args = append(args, userID)
	}
	status := data.NormalizeOrderStatus(filter.Status)
	if status == "all" {
		status = ""
	}
	if status != "" {
		if !data.IsValidOrderStatus(status) {
			return "", nil, repository.ErrInvalidOrderStatus
		}
		conditions = append(conditions, `o.status = ?`)
		args = append(args, status)
	}
	query := strings.TrimSpace(filter.Query)
	if query != "" {
		conditions = append(conditions, `(LOCATE(?, o.order_number) > 0 OR LOCATE(?, u.username) > 0 OR LOCATE(?, o.recipient_name) > 0 OR LOCATE(?, o.phone) > 0 OR LOCATE(?, o.shipping_address) > 0 OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND LOCATE(?, oi.product_name) > 0))`)
		args = append(args, query, query, query, query, query, query)
	}
	if len(conditions) == 0 {
		return "", args, nil
	}
	return " WHERE " + strings.Join(conditions, " AND "), args, nil
}

func loadOrderItems(ctx context.Context, queryer orderQueryer, order *data.Order) error {
	rows, err := queryer.QueryContext(ctx, `SELECT product_id, product_name, quantity, unit_price_vnd FROM order_items WHERE order_id = ? ORDER BY id`, order.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	order.Items = []data.OrderItem{}
	for rows.Next() {
		var item data.OrderItem
		if err := rows.Scan(&item.ProductID, &item.ProductName, &item.Quantity, &item.UnitPriceVND); err != nil {
			return err
		}
		order.Items = append(order.Items, item)
	}
	return rows.Err()
}

// loadOrder loads one order. A positive userID scopes the lookup so a customer
// cannot discover another customer's order.
func loadOrder(ctx context.Context, queryer orderQueryer, orderID, userID int64) (data.Order, error) {
	query := `SELECT ` + orderSelectColumns + ` FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`
	args := []any{orderID}
	if userID > 0 {
		query += ` AND o.user_id = ?`
		args = append(args, userID)
	}
	var order data.Order
	err := queryer.QueryRowContext(ctx, query, args...).Scan(&order.ID, &order.OrderNumber, &order.UserID, &order.CustomerName, &order.TotalVND, &order.Status, &order.PaymentMethod, &order.RecipientName, &order.Phone, &order.ShippingAddress, &order.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return data.Order{}, repository.ErrOrderNotFound
	}
	if err != nil {
		return data.Order{}, err
	}
	if err = loadOrderItems(ctx, queryer, &order); err != nil {
		return data.Order{}, err
	}
	return order, nil
}

// GetOrder returns an order only when it belongs to the authenticated customer.
func (m *StoreModel) GetOrder(ctx context.Context, userID, orderID int64) (data.Order, error) {
	return loadOrder(ctx, m.db, orderID, userID)
}

// GetAdminOrder loads an order and its immutable item snapshots for admin review.
func (m *StoreModel) GetAdminOrder(ctx context.Context, orderID int64) (data.Order, error) {
	return loadOrder(ctx, m.db, orderID, 0)
}

// CancelOrder allows a customer to cancel only a pending order. Repeating the
// request returns the cancelled order without restoring stock a second time.
func (m *StoreModel) CancelOrder(ctx context.Context, userID, orderID int64) (data.Order, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return data.Order{}, err
	}
	defer tx.Rollback()
	var status string
	err = tx.QueryRowContext(ctx, `SELECT status FROM orders WHERE id = ? AND user_id = ? FOR UPDATE`, orderID, userID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return data.Order{}, repository.ErrOrderNotFound
	}
	if err != nil {
		return data.Order{}, err
	}
	if status == data.OrderStatusCancelled {
		order, loadErr := loadOrder(ctx, tx, orderID, userID)
		if loadErr != nil {
			return data.Order{}, loadErr
		}
		if err = tx.Commit(); err != nil {
			return data.Order{}, err
		}
		return order, nil
	}
	if status != data.OrderStatusPending {
		return data.Order{}, repository.ErrInvalidOrderTransition
	}
	if err = restoreOrderStock(ctx, tx, orderID); err != nil {
		return data.Order{}, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE orders SET status = ? WHERE id = ? AND user_id = ? AND status = ?`, data.OrderStatusCancelled, orderID, userID, status)
	if err != nil {
		return data.Order{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return data.Order{}, err
	}
	if changed != 1 {
		return data.Order{}, repository.ErrInvalidOrderTransition
	}
	order, err := loadOrder(ctx, tx, orderID, userID)
	if err != nil {
		return data.Order{}, err
	}
	if err = tx.Commit(); err != nil {
		return data.Order{}, err
	}
	return order, nil
}

// UpdateOrderStatus applies the validated admin lifecycle transition and
// restores stock exactly once when an order is cancelled.
func (m *StoreModel) UpdateOrderStatus(ctx context.Context, orderID int64, next string) (data.Order, error) {
	next = data.NormalizeOrderStatus(next)
	if !data.IsOrderMutationStatus(next) {
		return data.Order{}, repository.ErrInvalidOrderTransition
	}
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return data.Order{}, err
	}
	defer tx.Rollback()
	var current string
	err = tx.QueryRowContext(ctx, `SELECT status FROM orders WHERE id = ? FOR UPDATE`, orderID).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		return data.Order{}, repository.ErrOrderNotFound
	}
	if err != nil {
		return data.Order{}, err
	}
	if current == next {
		order, loadErr := loadOrder(ctx, tx, orderID, 0)
		if loadErr != nil {
			return data.Order{}, loadErr
		}
		if err = tx.Commit(); err != nil {
			return data.Order{}, err
		}
		return order, nil
	}
	if !data.CanTransitionOrderStatus(current, next) {
		return data.Order{}, repository.ErrInvalidOrderTransition
	}
	if next == data.OrderStatusCancelled {
		if err = restoreOrderStock(ctx, tx, orderID); err != nil {
			return data.Order{}, err
		}
	}
	result, err := tx.ExecContext(ctx, `UPDATE orders SET status = ? WHERE id = ? AND status = ?`, next, orderID, current)
	if err != nil {
		return data.Order{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return data.Order{}, err
	}
	if changed != 1 {
		return data.Order{}, repository.ErrInvalidOrderTransition
	}
	order, err := loadOrder(ctx, tx, orderID, 0)
	if err != nil {
		return data.Order{}, err
	}
	if err = tx.Commit(); err != nil {
		return data.Order{}, err
	}
	return order, nil
}

func restoreOrderStock(ctx context.Context, tx *sql.Tx, orderID int64) error {
	rows, err := tx.QueryContext(ctx, `SELECT product_id, quantity FROM order_items WHERE order_id = ? ORDER BY product_id FOR UPDATE`, orderID)
	if err != nil {
		return err
	}
	type line struct {
		productID int64
		quantity  int
	}
	lines := []line{}
	for rows.Next() {
		var item line
		if err = rows.Scan(&item.productID, &item.quantity); err != nil {
			rows.Close()
			return err
		}
		lines = append(lines, item)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	// Cancellation restoration is part of the order lifecycle, not an admin
	// adjustment. It bumps stock_version for optimistic inventory visibility but
	// intentionally leaves stock_adjustments to the admin-only audit trail.
	for _, item := range lines {
		if _, err = tx.ExecContext(ctx, `UPDATE products SET stock = stock + ?, stock_version = stock_version + 1 WHERE id = ?`, item.quantity, item.productID); err != nil {
			return err
		}
	}
	return nil
}
