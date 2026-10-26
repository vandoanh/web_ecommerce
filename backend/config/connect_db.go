package config

import (
	"context"
	"database/sql"
	"fmt"

	// Register the MySQL driver for database/sql.
	_ "github.com/go-sql-driver/mysql"
	"time"
)

// InitMySQL opens and verifies a MySQL connection.
func InitMySQL(ctx context.Context, dsn string) (*sql.DB, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err = db.PingContext(pingCtx); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect mysql: %w", err)
	}
	return db, nil
}
