package model

import (
	"context"
	"database/sql"
	"errors"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"golang.org/x/crypto/bcrypt"
)

var ErrInvalidCredentials = errors.New("invalid credentials")

type UserModel struct{ db *sql.DB }

func NewUserModel(db *sql.DB) repository.UserRepository { return &UserModel{db: db} }

func (m *UserModel) FindUserByUsernameAndPassword(username, password string) (*data.User, error) {
	var user data.User
	var passwordHash string
	err := m.db.QueryRow(`SELECT id, username, email, password FROM users WHERE username = ? OR email = ? LIMIT 1`, username, username).
		Scan(&user.ID, &user.Username, &user.Email, &passwordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	if err = m.loadMemberships(&user); err != nil {
		return nil, err
	}
	return &user, nil
}

func (m *UserModel) RegisterCustomer(ctx context.Context, input data.RegisterInput) (*data.User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, "INSERT INTO users (username, email, password) VALUES (?, ?, ?)", input.Username, input.Email, string(hash))
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'customer'`, id); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO user_groups (user_id, group_id) SELECT ?, id FROM `groups` WHERE name = 'customers'", id); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &data.User{ID: id, Username: input.Username, Email: input.Email, Roles: []string{"customer"}, Groups: []string{"customers"}}, nil
}

func (m *UserModel) loadMemberships(user *data.User) error {
	rows, err := m.db.Query(`SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.name`, user.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	user.Roles = []string{}
	for rows.Next() {
		var role string
		if err := rows.Scan(&role); err != nil {
			return err
		}
		user.Roles = append(user.Roles, role)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	groups, err := m.db.Query("SELECT g.name FROM `groups` g JOIN user_groups ug ON ug.group_id = g.id WHERE ug.user_id = ? ORDER BY g.name", user.ID)
	if err != nil {
		return err
	}
	defer groups.Close()
	user.Groups = []string{}
	for groups.Next() {
		var group string
		if err := groups.Scan(&group); err != nil {
			return err
		}
		user.Groups = append(user.Groups, group)
	}
	return groups.Err()
}

func SeedAdminUser(ctx context.Context, db *sql.DB, username, password string) error {
	if username == "" || password == "" {
		return errors.New("admin username and password must be configured")
	}
	var userID int64
	err := db.QueryRowContext(ctx, "SELECT id FROM users WHERE username = ?", username).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		hash, hashErr := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if hashErr != nil {
			return hashErr
		}
		result, insertErr := db.ExecContext(ctx, `INSERT INTO users (username, password, email) VALUES (?, ?, ?)`, username, string(hash), username+"@local.store")
		if insertErr != nil {
			return insertErr
		}
		userID, err = result.LastInsertId()
		if err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if _, err = db.ExecContext(ctx, `DELETE FROM user_roles WHERE user_id = ? AND role_id IN (SELECT id FROM roles WHERE name = 'customer')`, userID); err != nil {
		return err
	}
	if _, err = db.ExecContext(ctx, "DELETE FROM user_groups WHERE user_id = ? AND group_id IN (SELECT id FROM `groups` WHERE name = 'customers')", userID); err != nil {
		return err
	}
	if _, err = db.ExecContext(ctx, `INSERT IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE name = 'admin'`, userID); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, "INSERT IGNORE INTO user_groups (user_id, group_id) SELECT ?, id FROM `groups` WHERE name = 'administrators'", userID)
	return err
}

func EnsureCustomerMemberships(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `INSERT IGNORE INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u CROSS JOIN roles r WHERE r.name = 'customer' AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)`); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, "INSERT IGNORE INTO user_groups (user_id, group_id) SELECT u.id, g.id FROM users u CROSS JOIN `groups` g WHERE g.name = 'customers' AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = 'admin')")
	return err
}
