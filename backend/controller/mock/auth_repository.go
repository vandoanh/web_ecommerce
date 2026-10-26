package mock

import (
	"context"
	"errors"

	"github.com/example/youtube-dashboard-go-next/backend/data"
)

// UserRepositoryMock is a test double for user lookups.
type UserRepositoryMock struct {
	FindUserFunc func(string, string) (*data.User, error)
	RegisterFunc func(context.Context, data.RegisterInput) (*data.User, error)
}

// FindUserByUsernameAndPassword delegates to the configured test function.
func (m *UserRepositoryMock) FindUserByUsernameAndPassword(u, p string) (*data.User, error) {
	return m.FindUserFunc(u, p)
}

func (m *UserRepositoryMock) RegisterCustomer(ctx context.Context, input data.RegisterInput) (*data.User, error) {
	if m.RegisterFunc == nil {
		return nil, errors.New("registration is not configured")
	}
	return m.RegisterFunc(ctx, input)
}
