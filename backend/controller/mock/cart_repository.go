package mock

import (
	"context"

	"github.com/example/youtube-dashboard-go-next/backend/data"
)

type CartRepositoryMock struct {
	GetCartFunc   func(context.Context, string) ([]data.CartItem, error)
	SaveCartFunc  func(context.Context, string, []data.CartItem) error
	ClearCartFunc func(context.Context, string) error
}

func (m *CartRepositoryMock) GetCart(ctx context.Context, cartID string) ([]data.CartItem, error) {
	return m.GetCartFunc(ctx, cartID)
}
func (m *CartRepositoryMock) SaveCart(ctx context.Context, cartID string, items []data.CartItem) error {
	return m.SaveCartFunc(ctx, cartID, items)
}
func (m *CartRepositoryMock) ClearCart(ctx context.Context, cartID string) error {
	return m.ClearCartFunc(ctx, cartID)
}
