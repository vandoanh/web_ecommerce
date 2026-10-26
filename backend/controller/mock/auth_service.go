package mock

import (
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/gin-gonic/gin"
)

// AuthServiceMock is a test double for token operations.
type AuthServiceMock struct {
	GenerateTokenFunc func(data.User) (string, error)
	ValidateTokenFunc func(*gin.Context, string) error
}

// GenerateToken delegates token creation to the configured test function.
func (m *AuthServiceMock) GenerateToken(u data.User) (string, error) { return m.GenerateTokenFunc(u) }

// ValidateToken delegates token validation to the configured test function.
func (m *AuthServiceMock) ValidateToken(c *gin.Context, t string) error {
	return m.ValidateTokenFunc(c, t)
}
