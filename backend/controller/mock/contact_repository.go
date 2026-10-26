package mock

import (
	"context"

	"github.com/example/youtube-dashboard-go-next/backend/data"
)

type ContactRepositoryMock struct {
	CreateContactFunc func(context.Context, data.CreateContactInput) (data.Contact, error)
	ListContactsFunc  func(context.Context) ([]data.Contact, error)
	DeleteContactFunc func(context.Context, int64) error
}

func (m *ContactRepositoryMock) CreateContact(ctx context.Context, input data.CreateContactInput) (data.Contact, error) {
	if m.CreateContactFunc == nil {
		return data.Contact{ID: 1}, nil
	}
	return m.CreateContactFunc(ctx, input)
}

func (m *ContactRepositoryMock) ListContacts(ctx context.Context) ([]data.Contact, error) {
	if m.ListContactsFunc == nil {
		return []data.Contact{}, nil
	}
	return m.ListContactsFunc(ctx)
}

func (m *ContactRepositoryMock) DeleteContact(ctx context.Context, id int64) error {
	if m.DeleteContactFunc == nil {
		return nil
	}
	return m.DeleteContactFunc(ctx, id)
}
