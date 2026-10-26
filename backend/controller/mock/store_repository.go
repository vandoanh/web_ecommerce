package mock

import (
	"context"

	"github.com/example/youtube-dashboard-go-next/backend/data"
)

type StoreRepositoryMock struct {
	ListCategoriesFunc func(context.Context) ([]data.Category, error)
	CreateCategoryFunc func(context.Context, data.CategoryInput) (data.Category, error)
	UpdateCategoryFunc func(context.Context, int64, data.CategoryInput) (data.Category, error)
	DeleteCategoryFunc func(context.Context, int64) error
	ListProductsFunc   func(context.Context, bool) ([]data.Product, error)
	GetProductFunc     func(context.Context, int64) (data.Product, error)
	CreateProductFunc  func(context.Context, data.CreateProductInput) (data.Product, error)
	UpdateProductFunc  func(context.Context, int64, data.CreateProductInput) (data.Product, error)
	DeleteProductFunc  func(context.Context, int64) error
	CreateOrderFunc    func(context.Context, int64, data.CreateOrderInput) (data.Order, error)
	ListOrdersFunc     func(context.Context, int64) ([]data.Order, error)
	DashboardStatsFunc func(context.Context) (data.DashboardStats, error)
}

func (m *StoreRepositoryMock) ListCategories(ctx context.Context) ([]data.Category, error) {
	if m.ListCategoriesFunc == nil {
		return []data.Category{}, nil
	}
	return m.ListCategoriesFunc(ctx)
}
func (m *StoreRepositoryMock) CreateCategory(ctx context.Context, input data.CategoryInput) (data.Category, error) {
	return m.CreateCategoryFunc(ctx, input)
}
func (m *StoreRepositoryMock) UpdateCategory(ctx context.Context, id int64, input data.CategoryInput) (data.Category, error) {
	return m.UpdateCategoryFunc(ctx, id, input)
}
func (m *StoreRepositoryMock) DeleteCategory(ctx context.Context, id int64) error {
	return m.DeleteCategoryFunc(ctx, id)
}

func (m *StoreRepositoryMock) ListProducts(ctx context.Context, includeInactive bool) ([]data.Product, error) {
	return m.ListProductsFunc(ctx, includeInactive)
}
func (m *StoreRepositoryMock) GetProduct(ctx context.Context, productID int64) (data.Product, error) {
	return m.GetProductFunc(ctx, productID)
}
func (m *StoreRepositoryMock) CreateProduct(ctx context.Context, input data.CreateProductInput) (data.Product, error) {
	return m.CreateProductFunc(ctx, input)
}
func (m *StoreRepositoryMock) UpdateProduct(ctx context.Context, id int64, input data.CreateProductInput) (data.Product, error) {
	return m.UpdateProductFunc(ctx, id, input)
}
func (m *StoreRepositoryMock) DeleteProduct(ctx context.Context, id int64) error {
	return m.DeleteProductFunc(ctx, id)
}
func (m *StoreRepositoryMock) CreateOrder(ctx context.Context, userID int64, input data.CreateOrderInput) (data.Order, error) {
	return m.CreateOrderFunc(ctx, userID, input)
}
func (m *StoreRepositoryMock) ListOrders(ctx context.Context, userID int64) ([]data.Order, error) {
	return m.ListOrdersFunc(ctx, userID)
}
func (m *StoreRepositoryMock) DashboardStats(ctx context.Context) (data.DashboardStats, error) {
	return m.DashboardStatsFunc(ctx)
}
