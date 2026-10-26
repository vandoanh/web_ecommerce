package main

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"github.com/example/youtube-dashboard-go-next/backend/config"
	"github.com/example/youtube-dashboard-go-next/backend/model"
	"github.com/example/youtube-dashboard-go-next/backend/route"
	"github.com/example/youtube-dashboard-go-next/backend/service"
	"log"
	"net/http"
	"strings"
	"time"
)

//go:embed migrations/001_init.sql
var storeMigration string

//go:embed migrations/002_users.sql
var usersMigration string

//go:embed migrations/003_categories.sql
var categoriesMigration string

//go:embed migrations/004_product_images.sql
var productImagesMigration string

type migration struct {
	version string
	name    string
	sql     string
	tables  []string
}

func runMigrations(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(32) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	migrations := []migration{
		{version: "001", name: "store", sql: storeMigration, tables: []string{"products", "orders", "order_items"}},
		{version: "002", name: "users", sql: usersMigration, tables: []string{"users", "roles", "groups", "user_roles", "user_groups"}},
		{version: "003", name: "categories", sql: categoriesMigration, tables: []string{"categories", "product_categories"}},
		{version: "004", name: "product images", sql: productImagesMigration, tables: []string{"product_images"}},
	}
	for _, current := range migrations {
		var applied bool
		if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?)`, current.version).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		// Existing installations predate schema_migrations. Baseline complete schemas
		// so startup does not rerun old DDL against a live database.
		complete := true
		for _, table := range current.tables {
			var exists bool
			if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?)`, table).Scan(&exists); err != nil {
				return err
			}
			complete = complete && exists
		}
		if !complete {
			for _, statement := range strings.Split(current.sql, ";") {
				if strings.TrimSpace(statement) == "" {
					continue
				}
				if _, err := db.ExecContext(ctx, statement); err != nil {
					return fmt.Errorf("initialize %s database: %w", current.name, err)
				}
			}
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO schema_migrations (version) VALUES (?)`, current.version); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	cfg := config.Load()
	if len(cfg.JWTSecret) < 32 {
		log.Fatal("JWT_SECRET must contain at least 32 characters")
	}
	ctx := context.Background()
	db, err := config.InitMySQL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	redisClient, err := config.InitRedis(ctx, cfg.RedisURL)
	if err != nil {
		log.Fatal(err)
	}
	defer redisClient.Close()
	if err = runMigrations(ctx, db); err != nil {
		log.Fatalf("initialize database: %v", err)
	}
	if err = model.EnsureCustomerMemberships(ctx, db); err != nil {
		log.Fatalf("initialize customer roles: %v", err)
	}
	if err = model.SeedAdminUser(ctx, db, cfg.AdminUsername, cfg.AdminPassword); err != nil {
		log.Fatalf("seed admin user: %v", err)
	}
	authRepository := model.NewUserModel(db)
	authService := service.NewAuthService(cfg.JWTSecret, 30*time.Minute)
	storeRepository := model.NewStoreModel(db)
	cartRepository := model.NewRedisCartModel(redisClient)
	router := route.SetupRouter(authRepository, storeRepository, cartRepository, authService, cfg.CORSOrigin)
	server := http.Server{Addr: ":" + cfg.Port, Handler: router, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("API listening on :%s", cfg.Port)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
