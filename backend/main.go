package main

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/example/youtube-dashboard-go-next/backend/config"
	"github.com/example/youtube-dashboard-go-next/backend/model"
	"github.com/example/youtube-dashboard-go-next/backend/route"
	"github.com/example/youtube-dashboard-go-next/backend/service"
	"github.com/go-sql-driver/mysql"
)

//go:embed migrations/001_init.sql
var storeMigration string

//go:embed migrations/002_users.sql
var usersMigration string

//go:embed migrations/003_categories.sql
var categoriesMigration string

//go:embed migrations/004_product_images.sql
var productImagesMigration string

//go:embed migrations/005_contacts.sql
var contactsMigration string

//go:embed migrations/006_checkout_orders.sql
var checkoutOrdersMigration string

type migrationColumn struct {
	table         string
	name          string
	dataType      string
	charMaxLength int64
	nullability   string
}

type migrationForeignKey struct {
	table            string
	column           string
	referencedTable  string
	referencedColumn string
}

type migration struct {
	version     string
	name        string
	sql         string
	tables      []string
	columns     []migrationColumn
	foreignKeys []migrationForeignKey
}

// migrationExecutor is the subset of database/sql used by the migration
// runner. Both *sql.DB and *sql.Conn satisfy it, so callers that need session
// affinity (for example an advisory-lock holder) can pin every migration
// statement to one connection instead of letting the pool choose.
type migrationExecutor interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// migrationWriteGuard runs immediately before every migration write. Returning
// an error aborts the migration before any further SQL is sent. The guard runs
// on the same pinned session as the DDL, so a lost advisory lock cannot be
// bypassed by continuing through a pooled *sql.DB.
type migrationWriteGuard func(context.Context) error

// checkoutPaymentMethodStatement is the only migration statement for which a
// duplicate-column error is treated as already satisfied. Keeping it exact
// avoids swallowing duplicate errors for unrelated columns or tables.
const checkoutPaymentMethodStatement = "ALTER TABLE orders ADD COLUMN payment_method VARCHAR(16) NOT NULL DEFAULT 'cod' AFTER status"

var migrationPlan = []migration{
	{version: "001", name: "store", sql: storeMigration, tables: []string{"products", "orders", "order_items"}},
	{version: "002", name: "users", sql: usersMigration, tables: []string{"users", "roles", "groups", "user_roles", "user_groups"}},
	{version: "003", name: "categories", sql: categoriesMigration, tables: []string{"categories", "product_categories"}},
	{version: "004", name: "product images", sql: productImagesMigration, tables: []string{"product_images"}},
	{version: "005", name: "contacts", sql: contactsMigration, tables: []string{"contacts"}},
	{
		version: "006",
		name:    "checkout orders",
		sql:     checkoutOrdersMigration,
		tables:  []string{"order_idempotency"},
		columns: []migrationColumn{
			{table: "orders", name: "payment_method", dataType: "varchar", charMaxLength: 16, nullability: "NO"},
			{table: "order_idempotency", name: "user_id", dataType: "int", nullability: "NO"},
			{table: "order_idempotency", name: "idempotency_key", dataType: "char", charMaxLength: 36, nullability: "NO"},
			{table: "order_idempotency", name: "request_hash", dataType: "char", charMaxLength: 64, nullability: "NO"},
			{table: "order_idempotency", name: "order_id", dataType: "bigint", nullability: "YES"},
			{table: "order_idempotency", name: "created_at", dataType: "datetime", nullability: "NO"},
		},
		foreignKeys: []migrationForeignKey{
			{table: "order_idempotency", column: "user_id", referencedTable: "users", referencedColumn: "id"},
			{table: "order_idempotency", column: "order_id", referencedTable: "orders", referencedColumn: "id"},
		},
	},
}

func runMigrations(ctx context.Context, db *sql.DB) error {
	return runMigrationsGuarded(ctx, db, nil)
}

// runMigrationsGuarded executes the plan through one executor and invokes guard
// before every write. A nil guard preserves the production behaviour. Tests use
// a pinned *sql.Conn plus a guard that re-proves advisory-lock ownership and
// schema identity before each DDL statement and version marker.
func runMigrationsGuarded(ctx context.Context, executor migrationExecutor, guard migrationWriteGuard) error {
	check := func() error {
		if guard == nil {
			return nil
		}
		return guard(ctx)
	}
	if err := check(); err != nil {
		return fmt.Errorf("refusing schema_migrations setup: %w", err)
	}
	if _, err := executor.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(32) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`); err != nil {
		return err
	}
	for _, current := range migrationPlan {
		if err := check(); err != nil {
			return fmt.Errorf("refusing migration %s: %w", current.version, err)
		}
		var applied bool
		if err := executor.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?)`, current.version).Scan(&applied); err != nil {
			return err
		}
		if applied {
			continue
		}
		// Existing installations predate schema_migrations. Baseline complete schemas
		// so startup does not rerun old DDL against a live database. MySQL init also
		// runs migrations before the Go runner sees them, so verify every table,
		// column type/nullability and foreign-key mapping before deciding to replay.
		ready, err := migrationSchemaReady(ctx, executor, current)
		if err != nil {
			return err
		}
		if !ready {
			for _, statement := range splitSQLStatements(current.sql) {
				if err := check(); err != nil {
					return fmt.Errorf("refusing migration %s statement: %w", current.version, err)
				}
				if _, err := executor.ExecContext(ctx, statement); err != nil {
					// A previous partial run (or the MySQL entrypoint) may have added
					// the payment column before failing to create the idempotency table.
					if isMigrationRecoveryError(err, current.version, statement) {
						continue
					}
					return fmt.Errorf("initialize %s database: %w", current.name, err)
				}
			}
		}
		// Do not record a version unless the complete expected schema is present.
		// This converts partial DDL or repair failures into a startup error instead
		// of silently marking an incomplete migration as applied.
		ready, err = migrationSchemaReady(ctx, executor, current)
		if err != nil {
			return err
		}
		if !ready {
			return fmt.Errorf("initialize %s database: migration %s did not produce the expected schema", current.name, current.version)
		}
		// INSERT IGNORE keeps the marker idempotent if another runner recorded the
		// same version between the initial check and this write.
		if err := check(); err != nil {
			return fmt.Errorf("refusing migration %s marker: %w", current.version, err)
		}
		if _, err := executor.ExecContext(ctx, `INSERT IGNORE INTO schema_migrations (version) VALUES (?)`, current.version); err != nil {
			return err
		}
	}
	if err := check(); err != nil {
		return fmt.Errorf("refusing migration completion: %w", err)
	}
	return nil
}

func migrationSchemaReady(ctx context.Context, executor migrationExecutor, current migration) (bool, error) {
	for _, table := range current.tables {
		var exists bool
		if err := executor.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?)`, table).Scan(&exists); err != nil {
			return false, err
		}
		if !exists {
			return false, nil
		}
	}
	for _, column := range current.columns {
		ready, err := migrationColumnReady(ctx, executor, column)
		if err != nil {
			return false, err
		}
		if !ready {
			return false, nil
		}
	}
	for _, foreignKey := range current.foreignKeys {
		ready, err := migrationForeignKeyReady(ctx, executor, foreignKey)
		if err != nil {
			return false, err
		}
		if !ready {
			return false, nil
		}
	}
	return true, nil
}

func migrationColumnReady(ctx context.Context, executor migrationExecutor, column migrationColumn) (bool, error) {
	var dataType, isNullable string
	var charMaxLength sql.NullInt64
	err := executor.QueryRowContext(ctx, `SELECT DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, column.table, column.name).Scan(&dataType, &isNullable, &charMaxLength)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return migrationColumnSatisfied(column, dataType, isNullable, charMaxLength), nil
}

func migrationColumnSatisfied(expected migrationColumn, dataType, isNullable string, charMaxLength sql.NullInt64) bool {
	if expected.dataType != "" && !strings.EqualFold(strings.TrimSpace(dataType), expected.dataType) {
		return false
	}
	if expected.nullability != "" && !strings.EqualFold(strings.TrimSpace(isNullable), expected.nullability) {
		return false
	}
	if expected.charMaxLength > 0 && (!charMaxLength.Valid || charMaxLength.Int64 != expected.charMaxLength) {
		return false
	}
	return true
}

// migrationForeignKeyReady verifies the actual referenced table and column,
// then compares the referencing and referenced column definitions. MySQL FK
// columns must agree on type and signedness, so checking only a constraint name
// would miss mismatched definitions (for example INT versus BIGINT).
func migrationForeignKeyReady(ctx context.Context, executor migrationExecutor, foreignKey migrationForeignKey) (bool, error) {
	var referencingType, referencedType string
	err := executor.QueryRowContext(ctx, `
SELECT src.COLUMN_TYPE, dst.COLUMN_TYPE
FROM information_schema.KEY_COLUMN_USAGE AS k
JOIN information_schema.COLUMNS AS src
  ON src.TABLE_SCHEMA = k.TABLE_SCHEMA
 AND src.TABLE_NAME = k.TABLE_NAME
 AND src.COLUMN_NAME = k.COLUMN_NAME
JOIN information_schema.COLUMNS AS dst
  ON dst.TABLE_SCHEMA = k.REFERENCED_TABLE_SCHEMA
 AND dst.TABLE_NAME = k.REFERENCED_TABLE_NAME
 AND dst.COLUMN_NAME = k.REFERENCED_COLUMN_NAME
WHERE k.TABLE_SCHEMA = DATABASE()
  AND k.TABLE_NAME = ?
  AND k.COLUMN_NAME = ?
  AND k.REFERENCED_TABLE_SCHEMA = DATABASE()
  AND k.REFERENCED_TABLE_NAME = ?
  AND k.REFERENCED_COLUMN_NAME = ?
LIMIT 1`,
		foreignKey.table, foreignKey.column, foreignKey.referencedTable, foreignKey.referencedColumn).
		Scan(&referencingType, &referencedType)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return foreignKeyColumnTypesCompatible(referencingType, referencedType), nil
}

func foreignKeyColumnTypesCompatible(referencing, referenced string) bool {
	return strings.EqualFold(normalizeColumnType(referencing), normalizeColumnType(referenced))
}

func normalizeColumnType(value string) string {
	return strings.Join(strings.Fields(strings.ToLower(value)), " ")
}

// splitSQLStatements splits a migration file without breaking on semicolons in
// quoted identifiers/strings or comments. MySQL-specific --, # and /* */ comments
// are removed before statements reach the driver.
func splitSQLStatements(contents string) []string {
	statements := []string{}
	var current strings.Builder
	flush := func() {
		statement := strings.TrimSpace(current.String())
		if statement != "" {
			statements = append(statements, statement)
		}
		current.Reset()
	}

	inSingle, inDouble, inBacktick, inLineComment, inBlockComment := false, false, false, false, false
	for i := 0; i < len(contents); i++ {
		character := contents[i]
		if inLineComment {
			if character == '\n' {
				inLineComment = false
				current.WriteByte(character)
			}
			continue
		}
		if inBlockComment {
			if character == '*' && i+1 < len(contents) && contents[i+1] == '/' {
				inBlockComment = false
				i++
			}
			continue
		}
		if inSingle || inDouble || inBacktick {
			current.WriteByte(character)
			if character == '\\' && i+1 < len(contents) {
				i++
				current.WriteByte(contents[i])
				continue
			}
			switch {
			case inSingle && character == '\'':
				if i+1 < len(contents) && contents[i+1] == '\'' {
					i++
					current.WriteByte(contents[i])
				} else {
					inSingle = false
				}
			case inDouble && character == '"':
				if i+1 < len(contents) && contents[i+1] == '"' {
					i++
					current.WriteByte(contents[i])
				} else {
					inDouble = false
				}
			case inBacktick && character == '`':
				if i+1 < len(contents) && contents[i+1] == '`' {
					i++
					current.WriteByte(contents[i])
				} else {
					inBacktick = false
				}
			}
			continue
		}

		switch {
		case character == '-' && i+1 < len(contents) && contents[i+1] == '-' && (i+2 >= len(contents) || isSQLSpace(contents[i+2])):
			inLineComment = true
			i++
		case character == '#':
			inLineComment = true
		case character == '/' && i+1 < len(contents) && contents[i+1] == '*':
			inBlockComment = true
			i++
			// Keep tokens on either side of a comment separated.
			current.WriteByte(' ')
		case character == '\'':
			inSingle = true
			current.WriteByte(character)
		case character == '"':
			inDouble = true
			current.WriteByte(character)
		case character == '`':
			inBacktick = true
			current.WriteByte(character)
		case character == ';':
			flush()
		default:
			current.WriteByte(character)
		}
	}
	flush()
	return statements
}

func isSQLSpace(character byte) bool {
	switch character {
	case ' ', '\t', '\n', '\r', '\f', '\v':
		return true
	default:
		return false
	}
}

func isMigrationRecoveryError(err error, version, statement string) bool {
	if version != "006" || normalizeSQLStatement(statement) != normalizeSQLStatement(checkoutPaymentMethodStatement) {
		return false
	}
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1060
}

func normalizeSQLStatement(statement string) string {
	statement = strings.TrimSpace(statement)
	statement = strings.TrimSuffix(statement, ";")
	return strings.ToUpper(strings.Join(strings.Fields(statement), " "))
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
	contactRepository := model.NewContactModel(db)
	router := route.SetupRouter(authRepository, storeRepository, cartRepository, contactRepository, authService, cfg.CORSOrigin)
	server := http.Server{Addr: ":" + cfg.Port, Handler: router, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("API listening on :%s", cfg.Port)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
