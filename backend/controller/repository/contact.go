package repository

import (
	"context"
	"errors"

	"github.com/example/youtube-dashboard-go-next/backend/data"
)

var ErrContactNotFound = errors.New("contact not found")

type ContactRepository interface {
	CreateContact(context.Context, data.CreateContactInput) (data.Contact, error)
	ListContacts(context.Context) ([]data.Contact, error)
	DeleteContact(context.Context, int64) error
}
