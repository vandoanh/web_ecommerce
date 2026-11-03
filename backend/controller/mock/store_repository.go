package mock

import (
	"context"
	"strings"

	"github.com/example/youtube-dashboard-go-next/backend/data"
)

type StoreRepositoryMock struct {
	ListCategoriesFunc      func(context.Context) ([]data.Category, error)
	CreateCategoryFunc      func(context.Context, data.CategoryInput) (data.Category, error)
	UpdateCategoryFunc      func(context.Context, int64, data.CategoryInput) (data.Category, error)
	DeleteCategoryFunc      func(context.Context, int64) error
	ListProductsFunc        func(context.Context, bool) ([]data.Product, error)
	GetProductFunc          func(context.Context, int64) (data.Product, error)
	CreateProductFunc       func(context.Context, data.CreateProductInput) (data.Product, error)
	UpdateProductFunc       func(context.Context, int64, data.CreateProductInput) (data.Product, error)
	DeleteProductFunc       func(context.Context, int64) error
	CreateOrderFunc         func(context.Context, int64, string, data.CreateOrderInput) (data.Order, bool, error)
	ListOrdersFunc          func(context.Context, int64, int, int) ([]data.Order, int64, error)
	AdminOrdersFilteredFunc func(context.Context, int, int, data.OrderFilter) ([]data.Order, int64, error)
	GetOrderFunc            func(context.Context, int64, int64) (data.Order, error)
	GetAdminOrderFunc       func(context.Context, int64) (data.Order, error)
	CancelOrderFunc         func(context.Context, int64, int64) (data.Order, error)
	UpdateOrderStatusFunc   func(context.Context, int64, string) (data.Order, error)
	DashboardStatsFunc      func(context.Context) (data.DashboardStats, error)
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
func (m *StoreRepositoryMock) CreateOrder(ctx context.Context, userID int64, key string, input data.CreateOrderInput) (data.Order, bool, error) {
	if m.CreateOrderFunc == nil {
		return data.Order{}, false, nil
	}
	return m.CreateOrderFunc(ctx, userID, key, input)
}
func (m *StoreRepositoryMock) ListOrders(ctx context.Context, userID int64, page, pageSize int) ([]data.Order, int64, error) {
	if m.ListOrdersFunc == nil {
		return []data.Order{}, 0, nil
	}
	return m.ListOrdersFunc(ctx, userID, page, pageSize)
}
func (m *StoreRepositoryMock) AdminOrdersFiltered(ctx context.Context, page, pageSize int, filter data.OrderFilter) ([]data.Order, int64, error) {
	if m.AdminOrdersFilteredFunc != nil {
		return m.AdminOrdersFilteredFunc(ctx, page, pageSize, filter)
	}
	if m.ListOrdersFunc == nil {
		return []data.Order{}, 0, nil
	}
	orders, total, err := m.ListOrdersFunc(ctx, 0, page, pageSize)
	if err != nil {
		return nil, 0, err
	}
	filtered := make([]data.Order, 0, len(orders))
	for _, order := range orders {
		if filter.Status != "" && order.Status != filter.Status {
			continue
		}
		if filter.Query != "" {
			searchable := strings.ToLower(strings.Join([]string{order.OrderNumber, order.CustomerName, order.RecipientName, order.Phone, order.ShippingAddress}, " "))
			for _, item := range order.Items {
				searchable += " " + strings.ToLower(item.ProductName)
			}
			if !strings.Contains(searchable, strings.ToLower(filter.Query)) {
				continue
			}
		}
		filtered = append(filtered, order)
	}
	if filter.Status != "" || filter.Query != "" {
		total = int64(len(filtered))
	}
	return filtered, total, nil
}
func (m *StoreRepositoryMock) GetOrder(ctx context.Context, userID, orderID int64) (data.Order, error) {
	if m.GetOrderFunc == nil {
		return data.Order{}, nil
	}
	return m.GetOrderFunc(ctx, userID, orderID)
}
func (m *StoreRepositoryMock) GetAdminOrder(ctx context.Context, orderID int64) (data.Order, error) {
	if m.GetAdminOrderFunc == nil {
		return data.Order{}, nil
	}
	return m.GetAdminOrderFunc(ctx, orderID)
}
func (m *StoreRepositoryMock) CancelOrder(ctx context.Context, userID, orderID int64) (data.Order, error) {
	if m.CancelOrderFunc == nil {
		return data.Order{}, nil
	}
	return m.CancelOrderFunc(ctx, userID, orderID)
}
func (m *StoreRepositoryMock) UpdateOrderStatus(ctx context.Context, orderID int64, status string) (data.Order, error) {
	if m.UpdateOrderStatusFunc == nil {
		return data.Order{}, nil
	}
	return m.UpdateOrderStatusFunc(ctx, orderID, status)
}
func (m *StoreRepositoryMock) DashboardStats(ctx context.Context) (data.DashboardStats, error) {
	return m.DashboardStatsFunc(ctx)
}
