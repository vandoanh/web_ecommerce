package model

import (
	"context"
	"database/sql"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
)

type ContactModel struct{ db *sql.DB }

func NewContactModel(db *sql.DB) repository.ContactRepository { return &ContactModel{db: db} }

func (m *ContactModel) CreateContact(ctx context.Context, input data.CreateContactInput) (data.Contact, error) {
	result, err := m.db.ExecContext(ctx,
		`INSERT INTO contacts (name, phone, address, map_location) VALUES (?, ?, ?, ?)`,
		input.Name, input.Phone, input.Address, input.MapLocation)
	if err != nil {
		return data.Contact{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return data.Contact{}, err
	}
	contact := data.Contact{ID: id, Name: input.Name, Phone: input.Phone, Address: input.Address, MapLocation: input.MapLocation}
	if err = m.db.QueryRowContext(ctx, `SELECT created_at FROM contacts WHERE id = ?`, id).Scan(&contact.CreatedAt); err != nil {
		return data.Contact{}, err
	}
	return contact, nil
}

func (m *ContactModel) ListContacts(ctx context.Context) ([]data.Contact, error) {
	rows, err := m.db.QueryContext(ctx,
		`SELECT id, name, phone, address, map_location, created_at FROM contacts ORDER BY created_at DESC, id DESC LIMIT 500`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	contacts := []data.Contact{}
	for rows.Next() {
		var contact data.Contact
		if err := rows.Scan(&contact.ID, &contact.Name, &contact.Phone, &contact.Address, &contact.MapLocation, &contact.CreatedAt); err != nil {
			return nil, err
		}
		contacts = append(contacts, contact)
	}
	return contacts, rows.Err()
}

func (m *ContactModel) DeleteContact(ctx context.Context, id int64) error {
	result, err := m.db.ExecContext(ctx, `DELETE FROM contacts WHERE id = ?`, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return repository.ErrContactNotFound
	}
	return nil
}
