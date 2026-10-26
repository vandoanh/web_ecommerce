package repository

import (
	"context"
	"errors"

	"github.com/example/youtube-dashboard-go-next/backend/data"
)

var ErrProductNotFound = errors.New("product not found")
var ErrCategoryNotFound = errors.New("category not found")

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
	CreateOrder(context.Context, int64, data.CreateOrderInput) (data.Order, error)
	ListOrders(context.Context, int64) ([]data.Order, error)
	DashboardStats(context.Context) (data.DashboardStats, error)
}
