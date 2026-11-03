package repository

import (
	"context"
	"errors"

	"github.com/example/youtube-dashboard-go-next/backend/data"
)

var ErrProductNotFound = errors.New("product not found")
var ErrCategoryNotFound = errors.New("category not found")

var ErrProductUnavailable = errors.New("one or more products are unavailable or out of stock")
var ErrIdempotencyConflict = errors.New("idempotency key was already used with a different request")
var ErrOrderNotFound = errors.New("order not found")
var ErrInvalidOrderTransition = errors.New("order status transition is not allowed")
var ErrDuplicateOrderProduct = errors.New("duplicate product IDs are not allowed")
var ErrInvalidOrderInput = errors.New("invalid order input")
var ErrInvalidOrderStatus = errors.New("invalid order status")

type StoreRepository interface {
	ListCategories(context.Context) ([]data.Category, error)
	CreateCategory(context.Context, data.CategoryInput) (data.Category, error)
	UpdateCategory(context.Context, int64, data.CategoryInput) (data.Category, error)
	DeleteCategory(context.Context, int64) error
	ListProducts(context.Context, bool) ([]data.Product, error)
	GetProduct(context.Context, int64) (data.Product, error)
	CreateProduct(context.Context, data.CreateProductInput) (data.Product, error)
	UpdateProduct(context.Context, int64, data.CreateProductInput) (data.Product, error)
	DeleteProduct(context.Context, int64) error
	CreateOrder(context.Context, int64, string, data.CreateOrderInput) (data.Order, bool, error)
	ListOrders(context.Context, int64, int, int) ([]data.Order, int64, error)
	AdminOrdersFiltered(context.Context, int, int, data.OrderFilter) ([]data.Order, int64, error)
	GetOrder(context.Context, int64, int64) (data.Order, error)
	GetAdminOrder(context.Context, int64) (data.Order, error)
	CancelOrder(context.Context, int64, int64) (data.Order, error)
	UpdateOrderStatus(context.Context, int64, string) (data.Order, error)
	DashboardStats(context.Context) (data.DashboardStats, error)
}
