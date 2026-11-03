package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func checkoutOrdersPlan(t *testing.T) migration {
	t.Helper()
	for _, current := range migrationPlan {
		if current.version == "006" {
			return current
		}
	}
	t.Fatal("migration 006 is not registered")
	return migration{}
}

func TestCheckoutOrdersMigrationDefinition(t *testing.T) {
	checkout := checkoutOrdersPlan(t)
	if checkout.sql != checkoutOrdersMigration {
		t.Fatal("migration 006 must embed migrations/006_checkout_orders.sql")
	}
	if len(checkout.tables) != 1 || checkout.tables[0] != "order_idempotency" {
		t.Fatalf("unexpected migration tables: %v", checkout.tables)
	}

	expectedColumns := []migrationColumn{
		{table: "orders", name: "payment_method", dataType: "varchar", charMaxLength: 16, nullability: "NO"},
		{table: "order_idempotency", name: "user_id", dataType: "int", nullability: "NO"},
		{table: "order_idempotency", name: "idempotency_key", dataType: "char", charMaxLength: 36, nullability: "NO"},
		{table: "order_idempotency", name: "request_hash", dataType: "char", charMaxLength: 64, nullability: "NO"},
		{table: "order_idempotency", name: "order_id", dataType: "bigint", nullability: "YES"},
		{table: "order_idempotency", name: "created_at", dataType: "datetime", nullability: "NO"},
	}
	columns := make(map[string]migrationColumn, len(checkout.columns))
	for _, column := range checkout.columns {
		columns[column.table+"."+column.name] = column
	}
	if len(columns) != len(expectedColumns) {
		t.Fatalf("unexpected migration columns: %+v", checkout.columns)
	}
	for _, expected := range expectedColumns {
		actual, ok := columns[expected.table+"."+expected.name]
		if !ok {
			t.Fatalf("migration 006 must verify %s.%s", expected.table, expected.name)
		}
		if actual.dataType != expected.dataType || actual.charMaxLength != expected.charMaxLength || actual.nullability != expected.nullability {
			t.Fatalf("unexpected schema expectation for %s.%s: %+v", expected.table, expected.name, actual)
		}
	}

	expectedForeignKeys := []migrationForeignKey{
		{table: "order_idempotency", column: "user_id", referencedTable: "users", referencedColumn: "id"},
		{table: "order_idempotency", column: "order_id", referencedTable: "orders", referencedColumn: "id"},
	}
	foreignKeys := make(map[string]migrationForeignKey, len(checkout.foreignKeys))
	for _, foreignKey := range checkout.foreignKeys {
		foreignKeys[foreignKey.table+"."+foreignKey.column] = foreignKey
	}
	if len(foreignKeys) != len(expectedForeignKeys) {
		t.Fatalf("unexpected migration foreign keys: %+v", checkout.foreignKeys)
	}
	for _, expected := range expectedForeignKeys {
		actual, ok := foreignKeys[expected.table+"."+expected.column]
		if !ok {
			t.Fatalf("migration 006 must verify foreign key on %s.%s", expected.table, expected.column)
		}
		if actual.referencedTable != expected.referencedTable || actual.referencedColumn != expected.referencedColumn {
			t.Fatalf("unexpected foreign key target for %s.%s: %+v", expected.table, expected.column, actual)
		}
	}

	contents := strings.ToLower(checkout.sql)
	if strings.Contains(contents, "user_id bigint") {
		t.Fatal("idempotency user_id must be INT to match users.id")
	}
	if !strings.Contains(contents, "order_id bigint null") {
		t.Fatal("idempotency order_id must be BIGINT NULL to match orders.id")
	}
	if !strings.Contains(contents, "idempotency_key char(36) not null") {
		t.Fatal("idempotency_key must remain CHAR(36) for the required UUID contract")
	}
	if !strings.Contains(contents, "add column payment_method") {
		t.Fatal("migration must add orders.payment_method for existing schemas")
	}

	foundPaymentStatement := false
	for _, statement := range splitSQLStatements(checkout.sql) {
		if normalizeSQLStatement(statement) == normalizeSQLStatement(checkoutPaymentMethodStatement) {
			foundPaymentStatement = true
			break
		}
	}
	if !foundPaymentStatement {
		t.Fatal("checkoutPaymentMethodStatement must stay in sync with migration 006")
	}
}

func TestSplitSQLStatements(t *testing.T) {
	statements := splitSQLStatements(checkoutOrdersMigration)
	if len(statements) != 3 {
		t.Fatalf("expected SET NAMES, ALTER and CREATE statements, got %d: %#v", len(statements), statements)
	}
	for _, statement := range statements {
		if strings.TrimSpace(statement) == "" {
			t.Fatal("splitSQLStatements returned an empty statement")
		}
		if strings.Contains(statement, "--") {
			t.Fatalf("comments must not be sent to MySQL: %q", statement)
		}
	}
}

func TestSplitSQLStatementsHandlesCommentsAndQuotes(t *testing.T) {
	input := "-- line; comment\n" +
		"CREATE TABLE t (value VARCHAR(10));\n" +
		"# hash; comment\n" +
		"INSERT INTO t VALUES ('a;b', \"c;d\", `e;f`);\n" +
		"/* block; comment */\n" +
		"INSERT INTO t VALUES ('it\\'s;fine', 'a'';b');"
	statements := splitSQLStatements(input)
	if len(statements) != 3 {
		t.Fatalf("unexpected statement count: %#v", statements)
	}
	joined := strings.Join(statements, "\n")
	for _, comment := range []string{"line; comment", "hash; comment", "block; comment"} {
		if strings.Contains(joined, comment) {
			t.Fatalf("comment %q was not stripped: %#v", comment, statements)
		}
	}
	if !strings.Contains(statements[1], "'a;b'") ||
		!strings.Contains(statements[1], "\"c;d\"") ||
		!strings.Contains(statements[1], "`e;f`") {
		t.Fatalf("quoted semicolons were split: %#v", statements[1])
	}
	if !strings.Contains(statements[2], "'it\\'s;fine'") || !strings.Contains(statements[2], "'a'';b'") {
		t.Fatalf("escaped quotes were split: %#v", statements[2])
	}
	if got := splitSQLStatements("SELECT 1--2;"); len(got) != 1 || !strings.Contains(got[0], "--") {
		t.Fatalf("-- without trailing whitespace must not start a comment: %#v", got)
	}
}

func TestMigrationColumnSatisfied(t *testing.T) {
	payment := migrationColumn{dataType: "varchar", charMaxLength: 16, nullability: "NO"}
	if !migrationColumnSatisfied(payment, "varchar", "NO", sql.NullInt64{Int64: 16, Valid: true}) {
		t.Fatal("matching payment_method definition should be ready")
	}
	if migrationColumnSatisfied(payment, "varchar", "YES", sql.NullInt64{Int64: 16, Valid: true}) {
		t.Fatal("nullable payment_method must not satisfy NOT NULL expectation")
	}
	if migrationColumnSatisfied(payment, "varchar", "NO", sql.NullInt64{Int64: 32, Valid: true}) {
		t.Fatal("wrong payment_method length must not satisfy the expectation")
	}
	if migrationColumnSatisfied(payment, "text", "NO", sql.NullInt64{}) {
		t.Fatal("wrong payment_method type must not satisfy the expectation")
	}

	orderID := migrationColumn{dataType: "bigint", nullability: "YES"}
	if !migrationColumnSatisfied(orderID, "bigint", "YES", sql.NullInt64{}) {
		t.Fatal("nullable order_id should be ready")
	}
	if migrationColumnSatisfied(orderID, "bigint", "NO", sql.NullInt64{}) {
		t.Fatal("non-null order_id must not satisfy nullable expectation")
	}
}

func TestForeignKeyColumnTypesCompatible(t *testing.T) {
	if !foreignKeyColumnTypesCompatible("int", "INT") {
		t.Fatal("case-insensitive identical FK column types should match")
	}
	if !foreignKeyColumnTypesCompatible("bigint", " BIGINT ") {
		t.Fatal("whitespace should not make identical FK column types incompatible")
	}
	if foreignKeyColumnTypesCompatible("int unsigned", "int") {
		t.Fatal("FK signedness mismatch must be rejected")
	}
	if foreignKeyColumnTypesCompatible("bigint", "int") {
		t.Fatal("FK type mismatch must be rejected")
	}
}

func TestMigrationRecoveryOnlyIgnoresExactDuplicatePaymentColumn(t *testing.T) {
	duplicate := &mysql.MySQLError{Number: 1060, Message: "Duplicate column name 'payment_method'"}
	known := "ALTER TABLE orders\n  ADD COLUMN payment_method VARCHAR(16) NOT NULL DEFAULT 'cod' AFTER status"
	if !isMigrationRecoveryError(duplicate, "006", known) {
		t.Fatal("duplicate payment_method column should be recoverable")
	}
	if !isMigrationRecoveryError(duplicate, "006", known+";") {
		t.Fatal("exact statement with a trailing semicolon should be recoverable")
	}
	if isMigrationRecoveryError(duplicate, "005", known) {
		t.Fatal("recovery must be limited to migration 006")
	}
	if isMigrationRecoveryError(duplicate, "006", "ALTER TABLE orders ADD COLUMN payment_method VARCHAR(32) NOT NULL DEFAULT 'cod' AFTER status") {
		t.Fatal("recovery must not suppress a different payment_method definition")
	}
	if isMigrationRecoveryError(duplicate, "006", "ALTER TABLE order_idempotency ADD COLUMN payment_method VARCHAR(16) NOT NULL DEFAULT 'cod' AFTER status") {
		t.Fatal("recovery must not suppress duplicate errors on another table")
	}
	if isMigrationRecoveryError(&mysql.MySQLError{Number: 1064}, "006", known) {
		t.Fatal("unrelated SQL errors must fail the migration")
	}
	if isMigrationRecoveryError(errors.New("duplicate column"), "006", known) {
		t.Fatal("non-MySQL errors must not be ignored")
	}
}

const (
	checkoutMigrationTestSchema          = "checkout_orders_migration_test"
	checkoutMigrationTestLockName        = "checkout_orders_migration_test:checkout_orders_apply_migrations"
	checkoutMigrationTestLockWaitSeconds = 30
	checkoutMigrationTestCleanupTimeout  = 30 * time.Second
)

// migrationTestRequiredTables is the complete set of application and runner
// tables that must be absent before this test sends any DDL. Deriving it from
// migrationPlan prevents a future migration from silently bypassing the
// fresh-schema guard.
func migrationTestRequiredTables(plan []migration) []string {
	tables := []string{"schema_migrations"}
	seen := map[string]struct{}{"schema_migrations": {}}
	for _, current := range plan {
		for _, table := range current.tables {
			if _, ok := seen[table]; ok {
				continue
			}
			seen[table] = struct{}{}
			tables = append(tables, table)
		}
	}
	return tables
}

// validateMigrationTestTarget fails closed before any DDL. The dedicated
// migration test schema must be empty: running against any pre-existing table
// (even one unrelated to the migration plan) could modify data through seed or
// update statements, or leave a partially owned schema behind.
func validateMigrationTestTarget(schema string, existingTables, requiredTables []string) error {
	if schema != checkoutMigrationTestSchema {
		return fmt.Errorf("refusing migration test schema %q; use exactly %s", schema, checkoutMigrationTestSchema)
	}
	if len(requiredTables) == 0 {
		return errors.New("refusing migration test without a required-table guard")
	}
	required := make(map[string]struct{}, len(requiredTables))
	for _, table := range requiredTables {
		if strings.TrimSpace(table) == "" {
			return errors.New("refusing migration test with an empty required table name")
		}
		if _, ok := required[table]; ok {
			return fmt.Errorf("refusing migration test with duplicate required table %q", table)
		}
		required[table] = struct{}{}
	}
	for _, table := range existingTables {
		if _, ok := required[table]; ok {
			return fmt.Errorf("refusing to modify pre-existing required table %q in %s; use a fresh dedicated schema", table, schema)
		}
	}
	if len(existingTables) > 0 {
		return fmt.Errorf("refusing migration test against non-empty schema %s (found table %q); use a fresh dedicated schema", schema, existingTables[0])
	}
	return nil
}

func migrationTestOptInEnabled(value string) bool { return value == "1" }

// migrationTestLease holds a dedicated MySQL advisory lock for the entire
// migration test. The lock is owned by one connection because a pooled *sql.DB
// cannot guarantee session affinity. Cleanup only releases this session's
// lock and closes the pinned connection; it never drops or recreates tables.
type migrationTestLease struct {
	conn   *sql.Conn
	closed bool
}

func acquireMigrationTestLease(t *testing.T, db *sql.DB) *migrationTestLease {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), (checkoutMigrationTestLockWaitSeconds+5)*time.Second)
	defer cancel()
	lease, err := tryAcquireMigrationTestLease(ctx, db, checkoutMigrationTestLockWaitSeconds)
	if err != nil {
		t.Fatalf("acquire exclusive migration test lock: %v", err)
	}
	t.Cleanup(func() { lease.cleanup(t) })
	return lease
}

func tryAcquireMigrationTestLease(ctx context.Context, db *sql.DB, waitSeconds int) (*migrationTestLease, error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("open dedicated lock connection: %w", err)
	}
	var acquired sql.NullInt64
	if err = conn.QueryRowContext(ctx, `SELECT GET_LOCK(?, ?)`, checkoutMigrationTestLockName, waitSeconds).Scan(&acquired); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("GET_LOCK: %w", err)
	}
	if !acquired.Valid {
		_ = conn.Close()
		return nil, fmt.Errorf("GET_LOCK returned NULL for %q", checkoutMigrationTestLockName)
	}
	if acquired.Int64 != 1 {
		_ = conn.Close()
		return nil, fmt.Errorf("lock %q is held by another migration test process", checkoutMigrationTestLockName)
	}
	lease := &migrationTestLease{conn: conn}
	if err = lease.assertWritable(ctx); err != nil {
		_ = lease.releaseLock(ctx)
		_ = conn.Close()
		return nil, err
	}
	return lease, nil
}

// migrationSessionReady is the pure guard predicate. It proves both that this
// exact MySQL session owns the advisory lock and that the session is still
// pointed at the one disposable schema this test may modify. Keeping it pure
// makes the fail-closed behaviour directly testable without a database.
func migrationSessionReady(schema, expectedSchema string, connectionID, lockOwner sql.NullInt64) error {
	if !connectionID.Valid || !lockOwner.Valid || connectionID.Int64 != lockOwner.Int64 {
		return fmt.Errorf("advisory lock %q is not held by this connection", checkoutMigrationTestLockName)
	}
	if schema != expectedSchema {
		return fmt.Errorf("lock connection is using schema %q; expected %s", schema, expectedSchema)
	}
	return nil
}

// assertWritable validates lock ownership and schema identity in one round
// trip on the pinned connection. Every migration write calls it immediately
// before sending DDL, so a dropped session aborts instead of continuing.
func (l *migrationTestLease) assertWritable(ctx context.Context) error {
	var schema string
	var connectionID, lockOwner sql.NullInt64
	if err := l.conn.QueryRowContext(ctx, `SELECT DATABASE(), CONNECTION_ID(), IS_USED_LOCK(?)`, checkoutMigrationTestLockName).Scan(&schema, &connectionID, &lockOwner); err != nil {
		return fmt.Errorf("verify migration test session: %w", err)
	}
	return migrationSessionReady(schema, checkoutMigrationTestSchema, connectionID, lockOwner)
}

func (l *migrationTestLease) releaseLock(ctx context.Context) error {
	var released sql.NullInt64
	if err := l.conn.QueryRowContext(ctx, `SELECT RELEASE_LOCK(?)`, checkoutMigrationTestLockName).Scan(&released); err != nil {
		return fmt.Errorf("RELEASE_LOCK: %w", err)
	}
	if !released.Valid || released.Int64 != 1 {
		return fmt.Errorf("RELEASE_LOCK returned %v; this session did not own the lock", released)
	}
	return nil
}

func (l *migrationTestLease) currentDatabase(ctx context.Context) (string, error) {
	var schema string
	if err := l.conn.QueryRowContext(ctx, `SELECT DATABASE()`).Scan(&schema); err != nil {
		return "", fmt.Errorf("read current database: %w", err)
	}
	return schema, nil
}

func (l *migrationTestLease) tables(ctx context.Context) ([]string, error) {
	rows, err := l.conn.QueryContext(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`)
	if err != nil {
		return nil, fmt.Errorf("list schema tables: %w", err)
	}
	defer rows.Close()
	var tables []string
	for rows.Next() {
		var table string
		if err = rows.Scan(&table); err != nil {
			return nil, fmt.Errorf("scan schema table: %w", err)
		}
		tables = append(tables, table)
	}
	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("list schema tables: %w", err)
	}
	return tables, nil
}

// cleanup releases the advisory lock and deliberately leaves every table in
// place. Reprovision the dedicated disposable schema externally before reruns.
func (l *migrationTestLease) cleanup(t *testing.T) {
	t.Helper()
	if l.closed {
		return
	}
	l.closed = true
	ctx, cancel := context.WithTimeout(context.Background(), checkoutMigrationTestCleanupTimeout)
	defer cancel()
	lockErr := l.assertWritable(ctx)
	if lockErr != nil {
		t.Errorf("migration test cleanup lost lock/schema: %v; schema preserved", lockErr)
	} else if err := l.releaseLock(ctx); err != nil {
		t.Errorf("migration test cleanup: %v", err)
	}
	if err := l.conn.Close(); err != nil {
		t.Errorf("migration test cleanup: close lock connection: %v", err)
	}
}

func TestMigrationTestRequiredTables(t *testing.T) {
	tables := migrationTestRequiredTables(migrationPlan)
	seen := make(map[string]struct{}, len(tables))
	for _, table := range tables {
		if _, ok := seen[table]; ok {
			t.Fatalf("required table %q is listed more than once", table)
		}
		seen[table] = struct{}{}
	}
	if _, ok := seen["schema_migrations"]; !ok {
		t.Fatal("required table guard must include schema_migrations")
	}
	for _, current := range migrationPlan {
		for _, table := range current.tables {
			if _, ok := seen[table]; !ok {
				t.Fatalf("required table guard does not include migration %s table %q", current.version, table)
			}
		}
	}
}

func TestValidateMigrationTestTargetFailsClosed(t *testing.T) {
	required := []string{"schema_migrations", "orders", "users"}
	cases := []struct {
		name     string
		schema   string
		existing []string
		required []string
		wantErr  bool
	}{
		{name: "fresh dedicated schema", schema: checkoutMigrationTestSchema, required: required},
		{name: "wrong schema", schema: "checkout_orders_test", required: required, wantErr: true},
		{name: "pre-existing required table", schema: checkoutMigrationTestSchema, existing: []string{"orders"}, required: required, wantErr: true},
		{name: "pre-existing unrelated table", schema: checkoutMigrationTestSchema, existing: []string{"audit_log"}, required: required, wantErr: true},
		{name: "empty required guard", schema: checkoutMigrationTestSchema, wantErr: true},
		{name: "empty required table name", schema: checkoutMigrationTestSchema, required: []string{""}, wantErr: true},
		{name: "duplicate required guard", schema: checkoutMigrationTestSchema, required: []string{"orders", "orders"}, wantErr: true},
	}
	for _, current := range cases {
		t.Run(current.name, func(t *testing.T) {
			err := validateMigrationTestTarget(current.schema, current.existing, current.required)
			if (err != nil) != current.wantErr {
				t.Fatalf("validateMigrationTestTarget() error = %v, wantErr %v", err, current.wantErr)
			}
		})
	}
}

func TestMigrationTestRequiresExplicitIsolatedOptIn(t *testing.T) {
	for _, value := range []string{"", "0", "true", "yes"} {
		if migrationTestOptInEnabled(value) {
			t.Errorf("opt-in accepted %q", value)
		}
	}
	if !migrationTestOptInEnabled("1") {
		t.Fatal("explicit opt-in value 1 should be accepted")
	}
}

func TestMigrationTestSchemaNamesAreDistinctFromOrderFixture(t *testing.T) {
	if checkoutMigrationTestSchema == "checkout_orders_test" {
		t.Fatal("migration test schema must not be shared with the checkout/order fixture")
	}
}

// recordingMigrationExecutor captures writes so a guard failure can be proven
// to occur before any SQL reaches the database.
type recordingMigrationExecutor struct {
	execs []string
}

func (f *recordingMigrationExecutor) ExecContext(_ context.Context, query string, _ ...any) (sql.Result, error) {
	f.execs = append(f.execs, query)
	return nil, nil
}

func (f *recordingMigrationExecutor) QueryContext(context.Context, string, ...any) (*sql.Rows, error) {
	return nil, errors.New("unexpected query")
}

func (f *recordingMigrationExecutor) QueryRowContext(context.Context, string, ...any) *sql.Row {
	return nil
}

func TestRunMigrationsGuardedStopsBeforeFirstWriteWhenGuardFails(t *testing.T) {
	executor := &recordingMigrationExecutor{}
	lockErr := errors.New("advisory lock lost")
	err := runMigrationsGuarded(context.Background(), executor, func(context.Context) error {
		return lockErr
	})
	if !errors.Is(err, lockErr) {
		t.Fatalf("runMigrationsGuarded() error = %v, want %v", err, lockErr)
	}
	if len(executor.execs) != 0 {
		t.Fatalf("guard failure still executed %d statements: %v", len(executor.execs), executor.execs)
	}
}

func TestMigrationSessionGuardFailsClosed(t *testing.T) {
	owner := sql.NullInt64{Int64: 7, Valid: true}
	other := sql.NullInt64{Int64: 8, Valid: true}
	missing := sql.NullInt64{}
	cases := []struct {
		name         string
		schema       string
		connectionID sql.NullInt64
		lockOwner    sql.NullInt64
		wantErr      bool
	}{
		{name: "owned lock and expected schema", schema: checkoutMigrationTestSchema, connectionID: owner, lockOwner: owner},
		{name: "wrong schema", schema: "another_schema", connectionID: owner, lockOwner: owner, wantErr: true},
		{name: "lock held by another session", schema: checkoutMigrationTestSchema, connectionID: owner, lockOwner: other, wantErr: true},
		{name: "lock not held", schema: checkoutMigrationTestSchema, connectionID: owner, lockOwner: missing, wantErr: true},
		{name: "unknown connection", schema: checkoutMigrationTestSchema, connectionID: missing, lockOwner: owner, wantErr: true},
	}
	for _, current := range cases {
		t.Run(current.name, func(t *testing.T) {
			err := migrationSessionReady(current.schema, checkoutMigrationTestSchema, current.connectionID, current.lockOwner)
			if (err != nil) != current.wantErr {
				t.Fatalf("migrationSessionReady() error = %v, wantErr %v", err, current.wantErr)
			}
		})
	}
}

func productStockDeliveryPlan(t *testing.T) migration {
	t.Helper()
	for _, current := range migrationPlan {
		if current.version == "007" {
			return current
		}
	}
	t.Fatal("migration 007 is not registered")
	return migration{}
}

func migrationContainsStatement(sql, target string) bool {
	normalizedTarget := normalizeSQLStatement(target)
	for _, statement := range splitSQLStatements(sql) {
		if normalizeSQLStatement(statement) == normalizedTarget {
			return true
		}
	}
	return false
}

func TestProductStockDeliveryMigrationDefinition(t *testing.T) {
	current := productStockDeliveryPlan(t)
	if current.sql != productStockDeliveryMigration {
		t.Fatal("migration 007 must embed migrations/007_product_stock_delivery.sql")
	}
	wantTables := map[string]bool{"stock_adjustments": true, "delivery_settings": true}
	if len(current.tables) != len(wantTables) {
		t.Fatalf("unexpected migration tables: %v", current.tables)
	}
	for _, table := range current.tables {
		if !wantTables[table] {
			t.Fatalf("unexpected migration table %q", table)
		}
	}

	expectedColumns := []migrationColumn{
		{table: "products", name: "regular_price_vnd", dataType: "bigint", nullability: "YES"},
		{table: "products", name: "discount_price_vnd", dataType: "bigint", nullability: "YES"},
		{table: "products", name: "discount_starts_at", dataType: "datetime", nullability: "YES"},
		{table: "products", name: "discount_ends_at", dataType: "datetime", nullability: "YES"},
		{table: "products", name: "stock_version", dataType: "bigint", nullability: "NO"},
		{table: "stock_adjustments", name: "id", dataType: "bigint", nullability: "NO"},
		{table: "stock_adjustments", name: "product_id", dataType: "bigint", nullability: "NO"},
		{table: "stock_adjustments", name: "delta", dataType: "int", nullability: "NO"},
		{table: "stock_adjustments", name: "stock_before", dataType: "int", nullability: "NO"},
		{table: "stock_adjustments", name: "stock_after", dataType: "int", nullability: "NO"},
		{table: "stock_adjustments", name: "stock_version_after", dataType: "bigint", nullability: "NO"},
		{table: "stock_adjustments", name: "reason", dataType: "varchar", charMaxLength: 255, nullability: "NO"},
		{table: "stock_adjustments", name: "actor_user_id", dataType: "int", nullability: "NO"},
		{table: "stock_adjustments", name: "idempotency_key", dataType: "char", charMaxLength: 36, nullability: "YES"},
		{table: "stock_adjustments", name: "request_hash", dataType: "char", charMaxLength: 64, nullability: "NO"},
		{table: "stock_adjustments", name: "created_at", dataType: "datetime", nullability: "NO"},
		{table: "delivery_settings", name: "id", dataType: "tinyint", nullability: "NO"},
		{table: "delivery_settings", name: "singleton", dataType: "tinyint", nullability: "NO"},
		{table: "delivery_settings", name: "phone", dataType: "varchar", charMaxLength: 32, nullability: "NO"},
		{table: "delivery_settings", name: "address", dataType: "text", nullability: "NO"},
		{table: "delivery_settings", name: "map_location", dataType: "text", nullability: "NO"},
		{table: "delivery_settings", name: "delivery_text", dataType: "text", nullability: "NO"},
		{table: "delivery_settings", name: "updated_at", dataType: "datetime", nullability: "NO"},
		{table: "delivery_settings", name: "version", dataType: "bigint", nullability: "NO"},
	}
	columns := make(map[string]migrationColumn, len(current.columns))
	for _, column := range current.columns {
		columns[column.table+"."+column.name] = column
	}
	if len(columns) != len(expectedColumns) {
		t.Fatalf("unexpected migration columns: %+v", current.columns)
	}
	for _, expected := range expectedColumns {
		actual, ok := columns[expected.table+"."+expected.name]
		if !ok {
			t.Fatalf("migration 007 must verify %s.%s", expected.table, expected.name)
		}
		if actual.dataType != expected.dataType || actual.charMaxLength != expected.charMaxLength || actual.nullability != expected.nullability {
			t.Fatalf("unexpected schema expectation for %s.%s: %+v", expected.table, expected.name, actual)
		}
	}

	expectedForeignKeys := []migrationForeignKey{
		{table: "stock_adjustments", column: "product_id", referencedTable: "products", referencedColumn: "id"},
		{table: "stock_adjustments", column: "actor_user_id", referencedTable: "users", referencedColumn: "id"},
	}
	foreignKeys := make(map[string]migrationForeignKey, len(current.foreignKeys))
	for _, foreignKey := range current.foreignKeys {
		foreignKeys[foreignKey.table+"."+foreignKey.column] = foreignKey
	}
	if len(foreignKeys) != len(expectedForeignKeys) {
		t.Fatalf("unexpected migration foreign keys: %+v", current.foreignKeys)
	}
	for _, expected := range expectedForeignKeys {
		actual, ok := foreignKeys[expected.table+"."+expected.column]
		if !ok {
			t.Fatalf("migration 007 must verify foreign key on %s.%s", expected.table, expected.column)
		}
		if actual.referencedTable != expected.referencedTable || actual.referencedColumn != expected.referencedColumn {
			t.Fatalf("unexpected foreign key target for %s.%s: %+v", expected.table, expected.column, actual)
		}
	}

	contents := strings.ToLower(current.sql)
	for _, fragment := range []string{
		"regular_price_vnd bigint",
		"discount_price_vnd bigint",
		"discount_starts_at datetime(6)",
		"discount_ends_at datetime(6)",
		"stock_version bigint not null default 0",
		"update products set regular_price_vnd = price_vnd",
		"idempotency_key char(36) null",
		"stock_adjustments_product_created_idx",
		"singleton tinyint generated always as (1) stored not null",
		"unique key delivery_settings_singleton_unique",
		"constraint delivery_settings_singleton check (id = 1)",
		"insert ignore into delivery_settings",
	} {
		if !strings.Contains(contents, fragment) {
			t.Fatalf("migration 007 is missing %q", fragment)
		}
	}
}

func TestStockAdjustmentAuditScopeIsDocumentedAsAdminOnly(t *testing.T) {
	current := productStockDeliveryPlan(t)
	contents := strings.ToLower(current.sql)
	for _, fragment := range []string{
		"admin stock-adjustment audit only",
		"orders/order_items",
		"intentionally not duplicated",
		"stock_version is an inventory revision counter, not an adjustment count",
	} {
		if !strings.Contains(contents, fragment) {
			t.Fatalf("migration 007 must document admin-only audit scope; missing %q", fragment)
		}
	}
}

func TestDeliverySettingsSingletonSurvivesMySQLWithoutEnforcedCheck(t *testing.T) {
	current := productStockDeliveryPlan(t)
	contents := strings.ToLower(current.sql)
	if !strings.Contains(contents, "singleton tinyint generated always as (1) stored not null") {
		t.Fatal("delivery_settings must have a generated singleton column")
	}
	if !strings.Contains(contents, "unique key delivery_settings_singleton_unique (singleton)") {
		t.Fatal("delivery_settings singleton column must be uniquely indexed")
	}
	if !strings.Contains(contents, "constraint delivery_settings_singleton check (id = 1)") {
		t.Fatal("delivery_settings should still declare the singleton CHECK on versions that enforce it")
	}
}

func TestMigration007AllowsOnlyExactDuplicateColumnRecovery(t *testing.T) {
	duplicate := &mysql.MySQLError{Number: 1060, Message: "Duplicate column name"}
	statements := recoverableDuplicateColumnStatements["007"]
	if len(statements) != 5 {
		t.Fatalf("unexpected 007 recovery statement count: %v", statements)
	}
	current := productStockDeliveryPlan(t)
	for _, statement := range statements {
		if !migrationContainsStatement(current.sql, statement) {
			t.Fatalf("007 recovery statement is not present in the migration: %q", statement)
		}
		if !isMigrationRecoveryError(duplicate, "007", statement) {
			t.Fatalf("exact 007 duplicate-column statement should be recoverable: %q", statement)
		}
		if isMigrationRecoveryError(duplicate, "006", statement) {
			t.Fatalf("007 recovery must not apply to version 006: %q", statement)
		}
	}
	wrong := "ALTER TABLE products ADD COLUMN regular_price_vnd INT NULL AFTER price_vnd"
	if isMigrationRecoveryError(duplicate, "007", wrong) {
		t.Fatal("recovery must not suppress a different 007 column definition")
	}
	if isMigrationRecoveryError(duplicate, "007", "CREATE TABLE stock_adjustments (id BIGINT PRIMARY KEY)") {
		t.Fatal("recovery must not suppress duplicate errors for other 007 statements")
	}
}

func verifyMigrationPlanApplied(t *testing.T, ctx context.Context, executor migrationExecutor) {
	t.Helper()
	for _, current := range migrationPlan {
		ready, err := migrationSchemaReady(ctx, executor, current)
		if err != nil {
			t.Fatalf("verify migration %s: %v", current.version, err)
		}
		if !ready {
			t.Fatalf("migration %s schema is incomplete after apply", current.version)
		}
		var markers int
		if err = executor.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, current.version).Scan(&markers); err != nil {
			t.Fatalf("migration %s markers: %v", current.version, err)
		}
		if markers != 1 {
			t.Fatalf("migration %s markers=%d, want exactly 1", current.version, markers)
		}
	}
}

func TestRunMigrationsAgainstDedicatedMySQL(t *testing.T) {
	if !migrationTestOptInEnabled(os.Getenv("CHECKOUT_MYSQL_TEST_ISOLATED")) {
		t.Skip("set CHECKOUT_MYSQL_TEST_ISOLATED=1 only for a verified disposable MySQL instance")
	}
	dsn := os.Getenv("CHECKOUT_MIGRATION_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("CHECKOUT_MIGRATION_TEST_DATABASE_URL not set; dedicated MySQL migration test skipped")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close dedicated MySQL migration schema: %v", err)
		}
	})
	if err = db.PingContext(ctx); err != nil {
		t.Fatalf("connect dedicated MySQL migration schema: %v", err)
	}

	lease := acquireMigrationTestLease(t, db)
	schema, err := lease.currentDatabase(ctx)
	if err != nil {
		t.Fatal(err)
	}
	existingTables, err := lease.tables(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = validateMigrationTestTarget(schema, existingTables, migrationTestRequiredTables(migrationPlan)); err != nil {
		t.Fatal(err)
	}
	if len(existingTables) != 0 {
		t.Fatalf("migration test requires an empty schema, found %v", existingTables)
	}
	if err = lease.assertWritable(ctx); err != nil {
		t.Fatal(err)
	}

	// Every migration statement runs on the pinned lock connection. If that
	// session drops, the executor returns ErrConnDone and the guard refuses to
	// write, so nothing can fall through to another pooled session.
	for run := 1; run <= 2; run++ {
		if err = lease.assertWritable(ctx); err != nil {
			t.Fatalf("migration run %d pre-check: %v", run, err)
		}
		if err = runMigrationsGuarded(ctx, lease.conn, lease.assertWritable); err != nil {
			t.Fatalf("migration run %d failed: %v", run, err)
		}
		if err = lease.assertWritable(ctx); err != nil {
			t.Fatalf("migration run %d post-check: %v", run, err)
		}
		verifyMigrationPlanApplied(t, ctx, lease.conn)
	}
	for _, foreignKey := range []migrationForeignKey{
		{table: "order_idempotency", column: "user_id", referencedTable: "users", referencedColumn: "id"},
		{table: "order_idempotency", column: "order_id", referencedTable: "orders", referencedColumn: "id"},
	} {
		ready, err := migrationForeignKeyReady(ctx, lease.conn, foreignKey)
		if err != nil || !ready {
			t.Fatalf("foreign key %s.%s -> %s.%s ready=%v err=%v", foreignKey.table, foreignKey.column, foreignKey.referencedTable, foreignKey.referencedColumn, ready, err)
		}
	}
	wrongTarget := migrationForeignKey{table: "order_idempotency", column: "user_id", referencedTable: "users", referencedColumn: "username"}
	if ready, err := migrationForeignKeyReady(ctx, lease.conn, wrongTarget); err != nil || ready {
		t.Fatalf("foreign key target verification should reject users.username: ready=%v err=%v", ready, err)
	}
	if err = lease.assertWritable(ctx); err != nil {
		t.Fatalf("migration test session lost lock or schema after operations: %v", err)
	}
}
