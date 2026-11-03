package model

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
)

const deliverySettingsSingletonID int64 = 1

const (
	deliveryPhoneMaxRunes   = 32
	deliveryAddressMaxRunes = 2000
	deliveryMapMaxRunes     = 2000
	deliveryTextMaxRunes    = 5000
)

func (m *StoreModel) GetDeliverySettings(ctx context.Context) (data.DeliverySettings, error) {
	var settings data.DeliverySettings
	err := m.db.QueryRowContext(ctx,
		`SELECT phone, address, map_location, delivery_text, updated_at, version FROM delivery_settings WHERE id = ?`,
		deliverySettingsSingletonID).
		Scan(&settings.Phone, &settings.Address, &settings.MapLocation, &settings.DeliveryText, &settings.UpdatedAt, &settings.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return data.DeliverySettings{}, repository.ErrDeliverySettingsNotFound
	}
	if err != nil {
		return data.DeliverySettings{}, err
	}
	settings.UpdatedAt = settings.UpdatedAt.UTC()
	return settings, nil
}

// UpdateDeliverySettings replaces the singleton row only when expectedVersion
// still matches, so a stale admin form cannot overwrite a newer update.
func (m *StoreModel) UpdateDeliverySettings(ctx context.Context, input data.UpdateDeliverySettingsInput) (data.DeliverySettings, error) {
	if input.ExpectedVersion == nil {
		return data.DeliverySettings{}, repository.ErrInvalidDeliverySettings
	}
	phone := strings.TrimSpace(input.Phone)
	address := strings.TrimSpace(input.Address)
	mapLocation := strings.TrimSpace(input.MapLocation)
	deliveryText := strings.TrimSpace(input.DeliveryText)
	if utf8.RuneCountInString(phone) > deliveryPhoneMaxRunes ||
		utf8.RuneCountInString(address) > deliveryAddressMaxRunes ||
		utf8.RuneCountInString(mapLocation) > deliveryMapMaxRunes ||
		utf8.RuneCountInString(deliveryText) > deliveryTextMaxRunes {
		return data.DeliverySettings{}, repository.ErrInvalidDeliverySettings
	}

	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return data.DeliverySettings{}, err
	}
	defer tx.Rollback()

	var currentVersion int64
	err = tx.QueryRowContext(ctx, `SELECT version FROM delivery_settings WHERE id = ? FOR UPDATE`, deliverySettingsSingletonID).Scan(&currentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return data.DeliverySettings{}, repository.ErrDeliverySettingsNotFound
	}
	if err != nil {
		return data.DeliverySettings{}, err
	}
	if *input.ExpectedVersion != currentVersion {
		return data.DeliverySettings{}, repository.ErrDeliveryVersionConflict
	}
	if _, err = tx.ExecContext(ctx,
		`UPDATE delivery_settings SET phone = ?, address = ?, map_location = ?, delivery_text = ?, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
		phone, address, mapLocation, deliveryText, deliverySettingsSingletonID); err != nil {
		return data.DeliverySettings{}, err
	}
	settings := data.DeliverySettings{
		Phone:        phone,
		Address:      address,
		MapLocation:  mapLocation,
		DeliveryText: deliveryText,
		Version:      currentVersion + 1,
	}
	err = tx.QueryRowContext(ctx,
		`SELECT updated_at FROM delivery_settings WHERE id = ?`,
		deliverySettingsSingletonID).Scan(&settings.UpdatedAt)
	if err != nil {
		return data.DeliverySettings{}, err
	}
	settings.UpdatedAt = settings.UpdatedAt.UTC()
	if err = tx.Commit(); err != nil {
		return data.DeliverySettings{}, err
	}
	return settings, nil
}
