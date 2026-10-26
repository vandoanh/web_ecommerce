package repository

import (
	"context"

	"github.com/example/youtube-dashboard-go-next/backend/data"
)

type CartRepository interface {
	GetCart(context.Context, string) ([]data.CartItem, error)
	SaveCart(context.Context, string, []data.CartItem) error
	ClearCart(context.Context, string) error
}
