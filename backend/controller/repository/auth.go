package repository

import (
	"context"

	"github.com/example/youtube-dashboard-go-next/backend/data"
)

type UserRepository interface {
	FindUserByUsernameAndPassword(username, password string) (*data.User, error)
	RegisterCustomer(context.Context, data.RegisterInput) (*data.User, error)
}
