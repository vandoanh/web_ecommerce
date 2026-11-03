package model

import (
	"context"
	"database/sql"
	"errors"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
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

func (m *StoreModel) loadProductCategories(ctx context.Context, productID int64) ([]data.Category, error) {
	rows, err := m.db.QueryContext(ctx, `SELECT c.id, c.name, c.slug, c.description FROM categories c JOIN product_categories pc ON pc.category_id = c.id WHERE pc.product_id = ? ORDER BY c.name`, productID)
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

func (m *StoreModel) ListProducts(ctx context.Context, includeInactive bool) ([]data.Product, error) {
	query := `SELECT id, sku, name, description, image_url, price_vnd, stock, is_active FROM products`
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
		var p data.Product
		if err := rows.Scan(&p.ID, &p.SKU, &p.Name, &p.Description, &p.ImageURL, &p.PriceVND, &p.Stock, &p.IsActive); err != nil {
			return nil, err
		}
		products = append(products, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	for i := range products {
		products[i].Categories, err = m.loadProductCategories(ctx, products[i].ID)
		if err != nil {
			return nil, err
		}
		products[i].Images, err = m.loadProductImages(ctx, products[i].ID)
		if err != nil {
			return nil, err
		}
	}
	return products, nil
}

func (m *StoreModel) GetProduct(ctx context.Context, productID int64) (data.Product, error) {
	var product data.Product
	err := m.db.QueryRowContext(ctx, `SELECT id, sku, name, description, image_url, price_vnd, stock, is_active FROM products WHERE id = ? AND is_active = TRUE`, productID).
		Scan(&product.ID, &product.SKU, &product.Name, &product.Description, &product.ImageURL, &product.PriceVND, &product.Stock, &product.IsActive)
	if errors.Is(err, sql.ErrNoRows) {
		return data.Product{}, repository.ErrProductNotFound
	}
	if err != nil {
		return product, err
	}
	product.Categories, err = m.loadProductCategories(ctx, productID)
	if err != nil {
		return product, err
	}
	product.Images, err = m.loadProductImages(ctx, productID)
	return product, err
}

func (m *StoreModel) loadProductImages(ctx context.Context, productID int64) ([]string, error) {
	rows, err := m.db.QueryContext(ctx, `SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order, id`, productID)
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

func (m *StoreModel) CreateProduct(ctx context.Context, input data.CreateProductInput) (data.Product, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return data.Product{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx,
		`INSERT INTO products (sku, name, description, image_url, price_vnd, stock) VALUES (?, ?, ?, ?, ?, ?)`,
		input.SKU, input.Name, input.Description, input.ImageURL, input.PriceVND, input.Stock)
	if err != nil {
		return data.Product{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return data.Product{}, err
	}
	if err = replaceProductCategories(ctx, tx, id, input.CategoryIDs); err != nil {
		return data.Product{}, err
	}
	if err = replaceProductImages(ctx, tx, id, input.ImageURLs); err != nil {
		return data.Product{}, err
	}
	if err = tx.Commit(); err != nil {
		return data.Product{}, err
	}
	product := data.Product{ID: id, SKU: input.SKU, Name: input.Name, Description: input.Description, ImageURL: input.ImageURL, PriceVND: input.PriceVND, Stock: input.Stock, IsActive: true}
	product.Categories, err = m.loadProductCategories(ctx, id)
	if err != nil {
		return product, err
	}
	product.Images = input.ImageURLs
	return product, nil
}

func (m *StoreModel) UpdateProduct(ctx context.Context, id int64, input data.CreateProductInput) (data.Product, error) {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return data.Product{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE products SET sku = ?, name = ?, description = ?, image_url = ?, price_vnd = ?, stock = ? WHERE id = ?`, input.SKU, input.Name, input.Description, input.ImageURL, input.PriceVND, input.Stock, id)
	if err != nil {
		return data.Product{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return data.Product{}, err
	}
	if count == 0 {
		var exists int
		if err = tx.QueryRowContext(ctx, `SELECT 1 FROM products WHERE id = ?`, id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
			return data.Product{}, repository.ErrProductNotFound
		} else if err != nil {
			return data.Product{}, err
		}
	}
	if err = replaceProductCategories(ctx, tx, id, input.CategoryIDs); err != nil {
		return data.Product{}, err
	}
	if err = replaceProductImages(ctx, tx, id, input.ImageURLs); err != nil {
		return data.Product{}, err
	}
	if err = tx.Commit(); err != nil {
		return data.Product{}, err
	}
	product := data.Product{ID: id, SKU: input.SKU, Name: input.Name, Description: input.Description, ImageURL: input.ImageURL, PriceVND: input.PriceVND, Stock: input.Stock, IsActive: true}
	product.Categories, err = m.loadProductCategories(ctx, id)
	if err != nil {
		return product, err
	}
	product.Images = input.ImageURLs
	return product, nil
}

func (m *StoreModel) DeleteProduct(ctx context.Context, id int64) error {
	result, err := m.db.ExecContext(ctx, `DELETE FROM products WHERE id = ?`, id)
	if err != nil {
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
