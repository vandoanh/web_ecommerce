package model

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"math"
	"math/big"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/go-sql-driver/mysql"
)

type StoreModel struct{ db *sql.DB }

func NewStoreModel(db *sql.DB) repository.StoreRepository { return &StoreModel{db: db} }

func (m *StoreModel) ListCategories(ctx context.Context) ([]data.Category, error) {
	rows, err := m.db.QueryContext(ctx, `SELECT id, name, slug, description FROM categories ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	categories := []data.Category{}
	for rows.Next() {
		var category data.Category
		if err := rows.Scan(&category.ID, &category.Name, &category.Slug, &category.Description); err != nil {
			return nil, err
		}
		categories = append(categories, category)
	}
	return categories, rows.Err()
}

func (m *StoreModel) CreateCategory(ctx context.Context, input data.CategoryInput) (data.Category, error) {
	result, err := m.db.ExecContext(ctx, `INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)`, input.Name, input.Slug, input.Description)
	if err != nil {
		return data.Category{}, err
	}
	id, err := result.LastInsertId()
	return data.Category{ID: id, Name: input.Name, Slug: input.Slug, Description: input.Description}, err
}

func (m *StoreModel) UpdateCategory(ctx context.Context, id int64, input data.CategoryInput) (data.Category, error) {
	result, err := m.db.ExecContext(ctx, `UPDATE categories SET name = ?, slug = ?, description = ? WHERE id = ?`, input.Name, input.Slug, input.Description, id)
	if err != nil {
		return data.Category{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return data.Category{}, err
	}
	if count == 0 {
		var exists int
		err = m.db.QueryRowContext(ctx, `SELECT 1 FROM categories WHERE id = ?`, id).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			return data.Category{}, repository.ErrCategoryNotFound
		}
		if err != nil {
			return data.Category{}, err
		}
	}
	return data.Category{ID: id, Name: input.Name, Slug: input.Slug, Description: input.Description}, nil
}

func (m *StoreModel) DeleteCategory(ctx context.Context, id int64) error {
	result, err := m.db.ExecContext(ctx, `DELETE FROM categories WHERE id = ?`, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count == 0 {
		return repository.ErrCategoryNotFound
	}
	return err
}

func replaceProductCategories(ctx context.Context, tx *sql.Tx, productID int64, categoryIDs []int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM product_categories WHERE product_id = ?`, productID); err != nil {
		return err
	}
	for _, categoryID := range categoryIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)`, productID, categoryID); err != nil {
			return err
		}
	}
	return nil
}

// productQueryer is implemented by both *sql.DB and *sql.Tx. Product reads use
// it so create/update responses can be loaded from the same transaction that
// persisted them, before commit, instead of failing after the write committed.
type productQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func loadProductCategories(ctx context.Context, queryer productQueryer, productID int64) ([]data.Category, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT c.id, c.name, c.slug, c.description FROM categories c JOIN product_categories pc ON pc.category_id = c.id WHERE pc.product_id = ? ORDER BY c.name`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	categories := []data.Category{}
	for rows.Next() {
		var category data.Category
		if err := rows.Scan(&category.ID, &category.Name, &category.Slug, &category.Description); err != nil {
			return nil, err
		}
		categories = append(categories, category)
	}
	return categories, rows.Err()
}

const (
	productSKUAlphabet     = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	productSKURandomLength = 10
	productSKUMaxAttempts  = 5
	productNameMaxRunes    = 255
	productReasonMaxRunes  = 255
	productSelectColumns   = `id, sku, name, description, image_url, COALESCE(regular_price_vnd, price_vnd), discount_price_vnd, discount_starts_at, discount_ends_at, stock, stock_version, is_active`
)

var productSKUPattern = regexp.MustCompile(`^TK[A-Z0-9]{10}$`)

// generateProductSKU returns "TK" plus ten cryptographically random base-36
// characters. The database unique index remains the final collision arbiter.
func generateProductSKU() (string, error) {
	var builder strings.Builder
	builder.Grow(2 + productSKURandomLength)
	builder.WriteString("TK")
	alphabetSize := big.NewInt(int64(len(productSKUAlphabet)))
	for i := 0; i < productSKURandomLength; i++ {
		index, err := rand.Int(rand.Reader, alphabetSize)
		if err != nil {
			return "", err
		}
		builder.WriteByte(productSKUAlphabet[index.Int64()])
	}
	return builder.String(), nil
}

func isValidGeneratedProductSKU(value string) bool {
	return productSKUPattern.MatchString(value)
}

type productRowScanner interface {
	Scan(...any) error
}

// scanProduct reads a product row and computes the effective price once using
// the request-scoped effectiveAt instant.
func scanProduct(scanner productRowScanner, effectiveAt time.Time) (data.Product, error) {
	var product data.Product
	var discount sql.NullInt64
	var startsAt, endsAt sql.NullTime
	err := scanner.Scan(
		&product.ID,
		&product.SKU,
		&product.Name,
		&product.Description,
		&product.ImageURL,
		&product.RegularPriceVND,
		&discount,
		&startsAt,
		&endsAt,
		&product.Stock,
		&product.StockVersion,
		&product.IsActive,
	)
	if err != nil {
		return data.Product{}, err
	}
	effectiveAt = effectiveAt.UTC()
	product.PriceEffectiveAt = effectiveAt
	if discount.Valid {
		value := discount.Int64
		product.DiscountPriceVND = &value
	}
	if startsAt.Valid {
		value := startsAt.Time.UTC()
		product.DiscountStartsAt = &value
	}
	if endsAt.Valid {
		value := endsAt.Time.UTC()
		product.DiscountEndsAt = &value
	}
	product.PriceVND = data.EffectiveProductPriceVND(product.RegularPriceVND, product.DiscountPriceVND, product.DiscountStartsAt, product.DiscountEndsAt, effectiveAt)
	return product, nil
}

func (m *StoreModel) ListProducts(ctx context.Context, includeInactive bool) ([]data.Product, error) {
	effectiveAt := time.Now().UTC()
	query := `SELECT ` + productSelectColumns + ` FROM products`
	if !includeInactive {
		query += ` WHERE is_active = TRUE`
	}
	query += ` ORDER BY created_at DESC, id DESC`
	rows, err := m.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	products := []data.Product{}
	for rows.Next() {
		product, err := scanProduct(rows, effectiveAt)
		if err != nil {
			return nil, err
		}
		products = append(products, product)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	for i := range products {
		products[i].Categories, err = loadProductCategories(ctx, m.db, products[i].ID)
		if err != nil {
			return nil, err
		}
		products[i].Images, err = loadProductImages(ctx, m.db, products[i].ID)
		if err != nil {
			return nil, err
		}
	}
	return products, nil
}

func (m *StoreModel) GetProduct(ctx context.Context, productID int64) (data.Product, error) {
	product, err := scanProduct(m.db.QueryRowContext(ctx, `SELECT `+productSelectColumns+` FROM products WHERE id = ? AND is_active = TRUE`, productID), time.Now().UTC())
	if errors.Is(err, sql.ErrNoRows) {
		return data.Product{}, repository.ErrProductNotFound
	}
	if err != nil {
		return data.Product{}, err
	}
	product.Categories, err = loadProductCategories(ctx, m.db, productID)
	if err != nil {
		return data.Product{}, err
	}
	product.Images, err = loadProductImages(ctx, m.db, productID)
	return product, err
}

// loadProductForAdmin reads the persisted product row and its associations
// through the supplied queryer. Create/update call it inside their transaction
// so the returned representation is exactly what will be committed and any
// read failure rolls the write back instead of surfacing after commit.
func loadProductForAdmin(ctx context.Context, queryer productQueryer, productID int64, effectiveAt time.Time) (data.Product, error) {
	product, err := scanProduct(queryer.QueryRowContext(ctx, `SELECT `+productSelectColumns+` FROM products WHERE id = ?`, productID), effectiveAt)
	if errors.Is(err, sql.ErrNoRows) {
		return data.Product{}, repository.ErrProductNotFound
	}
	if err != nil {
		return data.Product{}, err
	}
	product.Categories, err = loadProductCategories(ctx, queryer, productID)
	if err != nil {
		return data.Product{}, err
	}
	product.Images, err = loadProductImages(ctx, queryer, productID)
	if err != nil {
		return data.Product{}, err
	}
	return product, nil
}

func loadProductImages(ctx context.Context, queryer productQueryer, productID int64) ([]string, error) {
	rows, err := queryer.QueryContext(ctx, `SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order, id`, productID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	images := []string{}
	for rows.Next() {
		var imageURL string
		if err := rows.Scan(&imageURL); err != nil {
			return nil, err
		}
		images = append(images, imageURL)
	}
	return images, rows.Err()
}

func replaceProductImages(ctx context.Context, tx *sql.Tx, productID int64, imageURLs []string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM product_images WHERE product_id = ?`, productID); err != nil {
		return err
	}
	for index, imageURL := range imageURLs {
		if imageURL == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)`, productID, imageURL, index); err != nil {
			return err
		}
	}
	return nil
}

type normalizedProductInput struct {
	Name             string
	Description      string
	ImageURL         string
	ImageURLs        []string
	RegularPriceVND  int64
	DiscountPriceVND *int64
	DiscountStartsAt *time.Time
	DiscountEndsAt   *time.Time
	Stock            int
	IsActive         bool
	CategoryIDs      []int64
}

func normalizeProductFields(input data.CreateProductInput) (normalizedProductInput, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || utf8.RuneCountInString(name) > productNameMaxRunes {
		return normalizedProductInput{}, repository.ErrInvalidProductInput
	}
	regularPrice := input.PriceVND
	if input.RegularPriceVND != nil {
		if regularPrice != 0 && regularPrice != *input.RegularPriceVND {
			return normalizedProductInput{}, repository.ErrInvalidProductInput
		}
		regularPrice = *input.RegularPriceVND
	}
	if regularPrice <= 0 {
		return normalizedProductInput{}, repository.ErrInvalidProductInput
	}

	hasDiscountPrice := input.DiscountPriceVND != nil
	hasStart := input.DiscountStartsAt != nil
	hasEnd := input.DiscountEndsAt != nil
	var discountPrice *int64
	var startsAt, endsAt *time.Time
	if hasDiscountPrice || hasStart || hasEnd {
		if !hasDiscountPrice || !hasStart || !hasEnd {
			return normalizedProductInput{}, repository.ErrInvalidDiscountSchedule
		}
		if *input.DiscountPriceVND <= 0 || *input.DiscountPriceVND >= regularPrice {
			return normalizedProductInput{}, repository.ErrInvalidDiscountSchedule
		}
		start := input.DiscountStartsAt.UTC()
		end := input.DiscountEndsAt.UTC()
		if !end.After(start) {
			return normalizedProductInput{}, repository.ErrInvalidDiscountSchedule
		}
		value := *input.DiscountPriceVND
		discountPrice = &value
		startsAt = &start
		endsAt = &end
	}

	if input.Stock < 0 || int64(input.Stock) > math.MaxInt32 {
		return normalizedProductInput{}, repository.ErrInvalidProductInput
	}
	categoryIDs := append([]int64(nil), input.CategoryIDs...)
	seenCategories := make(map[int64]struct{}, len(categoryIDs))
	for _, categoryID := range categoryIDs {
		if categoryID < 1 {
			return normalizedProductInput{}, repository.ErrInvalidProductInput
		}
		if _, exists := seenCategories[categoryID]; exists {
			return normalizedProductInput{}, repository.ErrInvalidProductInput
		}
		seenCategories[categoryID] = struct{}{}
	}
	imageURLs := make([]string, len(input.ImageURLs))
	for i, imageURL := range input.ImageURLs {
		imageURLs[i] = strings.TrimSpace(imageURL)
	}
	isActive := true
	if input.IsActive != nil {
		isActive = *input.IsActive
	}
	return normalizedProductInput{
		Name:             name,
		Description:      input.Description,
		ImageURL:         strings.TrimSpace(input.ImageURL),
		ImageURLs:        imageURLs,
		RegularPriceVND:  regularPrice,
		DiscountPriceVND: discountPrice,
		DiscountStartsAt: startsAt,
		DiscountEndsAt:   endsAt,
		Stock:            input.Stock,
		IsActive:         isActive,
		CategoryIDs:      categoryIDs,
	}, nil
}

func nullableTimeValue(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UTC()
}

func mysqlErrorNumber(err error, number uint16) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == number
}

func isDuplicateKeyError(err error) bool   { return mysqlErrorNumber(err, 1062) }
func isForeignKeyViolation(err error) bool { return mysqlErrorNumber(err, 1452) }
func isReferencedRowError(err error) bool  { return mysqlErrorNumber(err, 1451) }

func (m *StoreModel) CreateProduct(ctx context.Context, input data.CreateProductInput) (data.Product, error) {
	normalized, err := normalizeProductFields(input)
	if err != nil {
		return data.Product{}, err
	}
	effectiveAt := time.Now().UTC()
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return data.Product{}, err
	}
	defer tx.Rollback()

	var id int64
	var sku string
	for attempt := 0; attempt < productSKUMaxAttempts; attempt++ {
		sku, err = generateProductSKU()
		if err != nil {
			return data.Product{}, err
		}
		result, insertErr := tx.ExecContext(ctx,
			`INSERT INTO products (sku, name, description, image_url, price_vnd, regular_price_vnd, discount_price_vnd, discount_starts_at, discount_ends_at, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			sku,
			normalized.Name,
			normalized.Description,
			normalized.ImageURL,
			normalized.RegularPriceVND,
			normalized.RegularPriceVND,
			normalized.DiscountPriceVND,
			nullableTimeValue(normalized.DiscountStartsAt),
			nullableTimeValue(normalized.DiscountEndsAt),
			normalized.Stock,
			normalized.IsActive,
		)
		if insertErr != nil {
			if isDuplicateKeyError(insertErr) {
				continue
			}
			if isForeignKeyViolation(insertErr) {
				return data.Product{}, repository.ErrInvalidProductInput
			}
			return data.Product{}, insertErr
		}
		id, err = result.LastInsertId()
		if err != nil {
			return data.Product{}, err
		}
		break
	}
	if id == 0 {
		return data.Product{}, repository.ErrSKUConflict
	}
	if err = replaceProductCategories(ctx, tx, id, normalized.CategoryIDs); err != nil {
		if isForeignKeyViolation(err) {
			return data.Product{}, repository.ErrInvalidProductInput
		}
		return data.Product{}, err
	}
	if err = replaceProductImages(ctx, tx, id, normalized.ImageURLs); err != nil {
		return data.Product{}, err
	}
	product, err := loadProductForAdmin(ctx, tx, id, effectiveAt)
	if err != nil {
		return data.Product{}, err
	}
	if err = tx.Commit(); err != nil {
		return data.Product{}, err
	}
	return product, nil
}

func (m *StoreModel) UpdateProduct(ctx context.Context, id int64, input data.CreateProductInput) (data.Product, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return data.Product{}, err
	}
	defer tx.Rollback()

	var existingSKU string
	err = tx.QueryRowContext(ctx, `SELECT sku FROM products WHERE id = ? FOR UPDATE`, id).
		Scan(&existingSKU)
	if errors.Is(err, sql.ErrNoRows) {
		return data.Product{}, repository.ErrProductNotFound
	}
	if err != nil {
		return data.Product{}, err
	}
	normalized, err := normalizeProductFields(input)
	if err != nil {
		return data.Product{}, err
	}
	sku := strings.TrimSpace(input.SKU)
	if sku == "" {
		sku = existingSKU
	}
	if len(sku) > 64 {
		return data.Product{}, repository.ErrInvalidProductInput
	}
	// Existing legacy codes remain editable without a rename; any new code must
	// use the generated TK format and relies on the unique index for conflicts.
	if sku != existingSKU && !isValidGeneratedProductSKU(sku) {
		return data.Product{}, repository.ErrInvalidProductInput
	}

	_, err = tx.ExecContext(ctx,
		`UPDATE products SET sku = ?, name = ?, description = ?, image_url = ?, price_vnd = ?, regular_price_vnd = ?, discount_price_vnd = ?, discount_starts_at = ?, discount_ends_at = ?, is_active = ? WHERE id = ?`,
		sku,
		normalized.Name,
		normalized.Description,
		normalized.ImageURL,
		normalized.RegularPriceVND,
		normalized.RegularPriceVND,
		normalized.DiscountPriceVND,
		nullableTimeValue(normalized.DiscountStartsAt),
		nullableTimeValue(normalized.DiscountEndsAt),
		normalized.IsActive,
		id,
	)
	if err != nil {
		if isDuplicateKeyError(err) {
			return data.Product{}, repository.ErrSKUConflict
		}
		if isForeignKeyViolation(err) {
			return data.Product{}, repository.ErrInvalidProductInput
		}
		return data.Product{}, err
	}
	if err = replaceProductCategories(ctx, tx, id, normalized.CategoryIDs); err != nil {
		if isForeignKeyViolation(err) {
			return data.Product{}, repository.ErrInvalidProductInput
		}
		return data.Product{}, err
	}
	if err = replaceProductImages(ctx, tx, id, normalized.ImageURLs); err != nil {
		return data.Product{}, err
	}
	// Read the persisted row and associations inside the transaction. The
	// response therefore reflects the exact committed state, and a read error
	// rolls the update back rather than returning an ambiguous post-commit 500.
	product, err := loadProductForAdmin(ctx, tx, id, time.Now().UTC())
	if err != nil {
		return data.Product{}, err
	}
	if err = tx.Commit(); err != nil {
		return data.Product{}, err
	}
	return product, nil
}

func (m *StoreModel) DeleteProduct(ctx context.Context, id int64) error {
	result, err := m.db.ExecContext(ctx, `DELETE FROM products WHERE id = ?`, id)
	if err != nil {
		if isReferencedRowError(err) {
			return repository.ErrProductHasStockHistory
		}
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count == 0 {
		return repository.ErrProductNotFound
	}
	return err
}

func (m *StoreModel) DashboardStats(ctx context.Context) (data.DashboardStats, error) {
	var stats data.DashboardStats
	err := m.db.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM products WHERE is_active = TRUE), (SELECT COUNT(*) FROM orders), (SELECT COUNT(*) FROM orders WHERE status = 'pending'), (SELECT COALESCE(SUM(total_vnd), 0) FROM orders WHERE status <> 'cancelled')`).
		Scan(&stats.ProductCount, &stats.OrderCount, &stats.PendingOrders, &stats.RevenueVND)
	return stats, err
}
