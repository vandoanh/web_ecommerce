package service

import (
	"context"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/gin-gonic/gin"
)

// AuthService defines access token operations used by HTTP handlers.
type AuthService interface {
	GenerateToken(data.User) (string, error)
	ValidateToken(*gin.Context, string) error
}

type UserRegistrar interface {
	RegisterCustomer(context.Context, data.RegisterInput) (*data.User, error)
}
