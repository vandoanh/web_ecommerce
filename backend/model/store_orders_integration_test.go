package model

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	_ "github.com/go-sql-driver/mysql"
)

const (
	integrationSchemaName = "checkout_orders_test"
	// MySQL advisory lock names are server-wide. Scope this one to the schema
	// and test lifecycle so it cannot collide with unrelated test suites.
	integrationLockName = "checkout_orders_test:checkout_orders_full_lifecycle"
	// A parallel test process may own the lock for the whole lifecycle. Wait
	// for it to finish instead of racing it.
	integrationLockWaitSeconds = 30
	integrationCleanupTimeout  = 30 * time.Second
)

// integrationTableSpec lists the tables this test owns, in creation order.
// These fixture tables are intentionally left in the disposable schema.
var integrationTableSpec = []struct {
	name      string
	statement string
}{
	{
		name:      "users",
		statement: `CREATE TABLE users (id INT NOT NULL PRIMARY KEY, username VARCHAR(255) NOT NULL) ENGINE=InnoDB`,
	},
	{
		name:      "products",
		statement: `CREATE TABLE products (id BIGINT NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL, price_vnd BIGINT NOT NULL, stock INT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE) ENGINE=InnoDB`,
	},
	{
		name:      "orders",
		statement: `CREATE TABLE orders (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, order_number VARCHAR(32) NOT NULL UNIQUE, user_id BIGINT NOT NULL, total_vnd BIGINT NOT NULL, status VARCHAR(32) NOT NULL, payment_method VARCHAR(16) NOT NULL DEFAULT 'cod', recipient_name VARCHAR(255) NOT NULL, phone VARCHAR(32) NOT NULL, shipping_address TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB`,
	},
	{
		name:      "order_items",
		statement: `CREATE TABLE order_items (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id BIGINT NOT NULL, product_id BIGINT NOT NULL, product_name VARCHAR(255) NOT NULL, quantity INT NOT NULL, unit_price_vnd BIGINT NOT NULL, CONSTRAINT order_items_order_fk FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE) ENGINE=InnoDB`,
	},
	{
		name:      "order_idempotency",
		statement: `CREATE TABLE order_idempotency (user_id INT NOT NULL, idempotency_key CHAR(36) NOT NULL, request_hash CHAR(64) NOT NULL, order_id BIGINT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,idempotency_key), UNIQUE KEY order_idempotency_order_unique(order_id), CONSTRAINT order_idempotency_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, CONSTRAINT order_idempotency_order_fk FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE) ENGINE=InnoDB`,
	},
}

func integrationTableNames() []string {
	names := make([]string, 0, len(integrationTableSpec))
	for _, spec := range integrationTableSpec {
		names = append(names, spec.name)
	}
	return names
}

func integrationTableStatement(name string) string {
	for _, spec := range integrationTableSpec {
		if spec.name == name {
			return spec.statement
		}
	}
	return ""
}

// integrationDB only runs against a dedicated schema named exactly
// checkout_orders_test. The test never creates or drops a database.
func integrationDB(t *testing.T) *sql.DB {
	t.Helper()
	if !integrationMySQLTestOptInEnabled(os.Getenv("CHECKOUT_MYSQL_TEST_ISOLATED")) {
		t.Skip("set CHECKOUT_MYSQL_TEST_ISOLATED=1 only for a verified disposable MySQL instance")
	}
	dsn := os.Getenv("CHECKOUT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("CHECKOUT_TEST_DATABASE_URL not set; dedicated MySQL integration tests skipped")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		t.Fatalf("connect dedicated MySQL test DB: %v", err)
	}
	var schema string
	if err = db.QueryRowContext(ctx, `SELECT DATABASE()`).Scan(&schema); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if schema != integrationSchemaName {
		db.Close()
		t.Fatalf("refusing integration schema %q; use exactly %s", schema, integrationSchemaName)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close integration DB: %v", err)
		}
	})
	return db
}

func integrationMySQLTestOptInEnabled(value string) bool { return value == "1" }

// integrationSchemaLease proves ownership of the dedicated schema for the
// entire test lifecycle. The advisory lock is held on a single dedicated
// connection; a pooled *sql.DB cannot guarantee session affinity. Cleanup
// releases the lock but leaves the fixture schema unchanged.
type integrationSchemaLease struct {
	conn     *sql.Conn
	lockName string
	closed   bool
}

// acquireIntegrationLease is the only entry point used by tests. It registers
// cleanup to release the advisory lock and close the pinned connection only.
func acquireIntegrationLease(t *testing.T, db *sql.DB) *integrationSchemaLease {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), (integrationLockWaitSeconds+5)*time.Second)
	defer cancel()
	lease, err := tryAcquireIntegrationLease(ctx, db, integrationLockWaitSeconds)
	if err != nil {
		t.Fatalf("acquire exclusive integration schema lock: %v", err)
	}
	t.Cleanup(func() { lease.cleanup(t) })
	return lease
}

func tryAcquireIntegrationLease(ctx context.Context, db *sql.DB, waitSeconds int) (*integrationSchemaLease, error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("open dedicated lock connection: %w", err)
	}
	var acquired sql.NullInt64
	if err = conn.QueryRowContext(ctx, `SELECT GET_LOCK(?, ?)`, integrationLockName, waitSeconds).Scan(&acquired); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("GET_LOCK: %w", err)
	}
	if !acquired.Valid {
		_ = conn.Close()
		return nil, fmt.Errorf("GET_LOCK returned NULL for %q", integrationLockName)
	}
	if acquired.Int64 != 1 {
		_ = conn.Close()
		return nil, fmt.Errorf("lock %q is held by another integration test process", integrationLockName)
	}
	lease := &integrationSchemaLease{conn: conn, lockName: integrationLockName}
	if err = lease.assertWritable(ctx); err != nil {
		_ = lease.releaseLock(ctx)
		_ = conn.Close()
		return nil, err
	}
	return lease, nil
}

// integrationSessionReady is the pure guard predicate. It proves both that
// this exact MySQL session owns the advisory lock and that the session is
// still pointed at the one dedicated schema this test may modify. Keeping it
// pure makes the fail-closed behaviour directly testable without a database.
func integrationSessionReady(schema, expectedSchema string, connectionID, lockOwner sql.NullInt64) error {
	if !connectionID.Valid || !lockOwner.Valid || connectionID.Int64 != lockOwner.Int64 {
		return fmt.Errorf("advisory lock %q is not held by this connection", integrationLockName)
	}
	if schema != expectedSchema {
		return fmt.Errorf("lock connection is using schema %q; expected %s", schema, expectedSchema)
	}
	return nil
}

// assertWritable validates lock ownership and schema identity in one round
// trip on the pinned connection. Every setup DDL, seed write and cleanup drop
// calls it immediately before writing, so a dropped session aborts instead of
// continuing through a pooled connection.
func (l *integrationSchemaLease) assertWritable(ctx context.Context) error {
	var schema string
	var connectionID, lockOwner sql.NullInt64
	if err := l.conn.QueryRowContext(ctx, `SELECT DATABASE(), CONNECTION_ID(), IS_USED_LOCK(?)`, l.lockName).Scan(&schema, &connectionID, &lockOwner); err != nil {
		return fmt.Errorf("verify integration schema session: %w", err)
	}
	return integrationSessionReady(schema, integrationSchemaName, connectionID, lockOwner)
}

func (l *integrationSchemaLease) releaseLock(ctx context.Context) error {
	var released sql.NullInt64
	if err := l.conn.QueryRowContext(ctx, `SELECT RELEASE_LOCK(?)`, l.lockName).Scan(&released); err != nil {
		return fmt.Errorf("RELEASE_LOCK: %w", err)
	}
	if !released.Valid || released.Int64 != 1 {
		return fmt.Errorf("RELEASE_LOCK returned %v; this session did not own the lock", released)
	}
	return nil
}

func (l *integrationSchemaLease) tableExists(ctx context.Context, table string) (bool, error) {
	var exists bool
	if err := l.conn.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?)`, table).Scan(&exists); err != nil {
		return false, fmt.Errorf("check table %q: %w", table, err)
	}
	return exists, nil
}

// verifyFreshSchema refuses to run against a schema containing any table this
// test would need. The check runs while the exclusive advisory lock is held.
func (l *integrationSchemaLease) verifyFreshSchema(ctx context.Context) error {
	if err := l.assertWritable(ctx); err != nil {
		return err
	}
	for _, table := range integrationTableNames() {
		exists, err := l.tableExists(ctx, table)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("refusing to modify pre-existing table %q in %s; use a fresh dedicated schema", table, integrationSchemaName)
		}
	}
	return nil
}

// createTrackedTable creates one fixture table in the empty dedicated schema.
// The lock and schema are re-proven immediately before and after the DDL.
func (l *integrationSchemaLease) createTrackedTable(ctx context.Context, table, statement string) error {
	if statement == "" {
		return fmt.Errorf("no create statement for %q", table)
	}
	if err := l.assertWritable(ctx); err != nil {
		return fmt.Errorf("refusing to create table %q: %w", table, err)
	}
	if _, err := l.conn.ExecContext(ctx, statement); err != nil {
		return fmt.Errorf("create table %q: %w", table, err)
	}
	if err := l.assertWritable(ctx); err != nil {
		return fmt.Errorf("created table %q but lost lock or schema: %w", table, err)
	}
	return nil
}

// verifyExpectedTables re-checks the lock and confirms every fixture table exists.
func (l *integrationSchemaLease) verifyExpectedTables(ctx context.Context) error {
	if err := l.assertWritable(ctx); err != nil {
		return err
	}
	for _, table := range integrationTableNames() {
		exists, err := l.tableExists(ctx, table)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("expected table %q is missing after setup", table)
		}
	}
	return nil
}

func (l *integrationSchemaLease) setup(ctx context.Context) error {
	if err := l.verifyFreshSchema(ctx); err != nil {
		return err
	}
	for _, spec := range integrationTableSpec {
		if err := l.createTrackedTable(ctx, spec.name, spec.statement); err != nil {
			return err
		}
	}
	if err := l.assertWritable(ctx); err != nil {
		return fmt.Errorf("before seeding users: %w", err)
	}
	if _, err := l.conn.ExecContext(ctx, `INSERT INTO users(id,username) VALUES (1,'customer'),(2,'other')`); err != nil {
		return fmt.Errorf("seed users: %w", err)
	}
	if err := l.assertWritable(ctx); err != nil {
		return fmt.Errorf("before seeding products: %w", err)
	}
	if _, err := l.conn.ExecContext(ctx, `INSERT INTO products(id,name,price_vnd,stock) VALUES (11,'snapshot name',100,5),(12,'second',250,2)`); err != nil {
		return fmt.Errorf("seed products: %w", err)
	}
	if err := l.assertWritable(ctx); err != nil {
		return fmt.Errorf("after seeding: %w", err)
	}
	return l.verifyExpectedTables(ctx)
}

func (l *integrationSchemaLease) cleanup(t *testing.T) {
	t.Helper()
	if l.closed {
		return
	}
	l.closed = true
	ctx, cancel := context.WithTimeout(context.Background(), integrationCleanupTimeout)
	defer cancel()

	lockErr := l.assertWritable(ctx)
	if lockErr != nil {
		t.Errorf("integration schema cleanup: lost lock or schema: %v; fixture is preserved", lockErr)
	} else if err := l.releaseLock(ctx); err != nil {
		t.Errorf("integration schema cleanup: %v", err)
	}
	if err := l.conn.Close(); err != nil {
		t.Errorf("integration schema cleanup: close lock connection: %v", err)
	}
}

func TestCheckoutOrdersMySQLIntegration(t *testing.T) {
	db := integrationDB(t)
	ctx := context.Background()

	lease := acquireIntegrationLease(t, db)
	if err := lease.setup(ctx); err != nil {
		t.Fatal(err)
	}

	// The production store intentionally uses the pool: the concurrency test
	// needs independent transactions on separate sessions. It performs no DDL;
	// every schema mutation and direct test assertion above and below runs on
	// the pinned lock connection, and the lease is re-verified after the store
	// operations finish.
	store := &StoreModel{db: db}
	input := data.CreateOrderInput{RecipientName: "Buyer", Phone: "123", ShippingAddress: "Address", Items: []data.OrderLineInput{{ProductID: 11, Quantity: 2}}}
	key := "9d77cd79-d774-45d0-a960-566b94069386"
	if _, _, err := store.CreateOrder(ctx, 1, key, data.CreateOrderInput{RecipientName: "B", Phone: "123", ShippingAddress: "Address", Items: []data.OrderLineInput{{ProductID: 11, Quantity: 2}, {ProductID: 11, Quantity: 1}}}); err != repository.ErrDuplicateOrderProduct {
		t.Fatalf("expected duplicate product validation, got %v", err)
	}
	order, replay, err := store.CreateOrder(ctx, 1, key, input)
	if err != nil || replay {
		t.Fatalf("create order=%+v replay=%v err=%v", order, replay, err)
	}
	if order.TotalVND != 200 || order.PaymentMethod != "cod" {
		t.Fatalf("unexpected trusted total/payment: %+v", order)
	}
	if err = lease.assertWritable(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = lease.conn.ExecContext(ctx, `UPDATE products SET name='changed',price_vnd=999 WHERE id=11`); err != nil {
		t.Fatal(err)
	}
	replayedOrder, replay, err := store.CreateOrder(ctx, 1, key, input)
	if err != nil || !replay || replayedOrder.ID != order.ID {
		t.Fatalf("replay=%+v replayed=%v err=%v", replayedOrder, replay, err)
	}
	changed := input
	changed.Phone = "different"
	if _, _, err = store.CreateOrder(ctx, 1, key, changed); err != repository.ErrIdempotencyConflict {
		t.Fatalf("expected idempotency conflict, got %v", err)
	}
	var stock int
	if err = lease.conn.QueryRowContext(ctx, `SELECT stock FROM products WHERE id=11`).Scan(&stock); err != nil || stock != 3 {
		t.Fatalf("stock=%d err=%v", stock, err)
	}
	var snapshotName string
	var unitPrice int64
	if err = lease.conn.QueryRowContext(ctx, `SELECT product_name,unit_price_vnd FROM order_items WHERE order_id=?`, order.ID).Scan(&snapshotName, &unitPrice); err != nil || snapshotName != "snapshot name" || unitPrice != 100 {
		t.Fatalf("snapshot=%q/%d err=%v", snapshotName, unitPrice, err)
	}
	if _, err = store.GetOrder(ctx, 2, order.ID); err != repository.ErrOrderNotFound {
		t.Fatalf("non-owner lookup should not disclose order: %v", err)
	}
	if _, err = store.CancelOrder(ctx, 1, order.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.CancelOrder(ctx, 1, order.ID); err != nil {
		t.Fatal(err)
	}
	if err = lease.conn.QueryRowContext(ctx, `SELECT stock FROM products WHERE id=11`).Scan(&stock); err != nil || stock != 5 {
		t.Fatalf("cancel stock=%d err=%v", stock, err)
	}
	if _, _, err = store.CreateOrder(ctx, 2, key, input); err != nil {
		t.Fatalf("idempotency key should be customer scoped: %v", err)
	}

	// Concurrent buyers cannot collectively oversell the two remaining units.
	concurrentInput := data.CreateOrderInput{RecipientName: "B", Phone: "1", ShippingAddress: "A", Items: []data.OrderLineInput{{ProductID: 12, Quantity: 2}}}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := []string{"c99f1d00-2b55-4bb2-a9a2-7ed224fce100", "c99f1d00-2b55-4bb2-a9a2-7ed224fce101"}[n]
			_, _, e := store.CreateOrder(ctx, 1, key, concurrentInput)
			results <- e
		}(i)
	}
	wg.Wait()
	close(results)
	succeeded := 0
	for e := range results {
		if e == nil {
			succeeded++
		} else if !errors.Is(e, repository.ErrProductUnavailable) {
			t.Errorf("unexpected concurrent checkout error: %v", e)
		}
	}
	if succeeded != 1 {
		t.Fatalf("expected exactly one concurrent order, got %d", succeeded)
	}
	if err = lease.conn.QueryRowContext(ctx, `SELECT stock FROM products WHERE id=12`).Scan(&stock); err != nil || stock != 0 {
		t.Fatalf("concurrent stock=%d err=%v", stock, err)
	}
	var pendingOrderID int64
	if err = lease.conn.QueryRowContext(ctx, `SELECT id FROM orders WHERE status='pending' AND user_id=1 ORDER BY id DESC LIMIT 1`).Scan(&pendingOrderID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.UpdateOrderStatus(ctx, pendingOrderID, "cancelled"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.UpdateOrderStatus(ctx, pendingOrderID, "cancelled"); err != nil {
		t.Fatal(err)
	}
	if err = lease.conn.QueryRowContext(ctx, `SELECT stock FROM products WHERE id=12`).Scan(&stock); err != nil || stock != 2 {
		t.Fatalf("admin cancellation should restore stock once: stock=%d err=%v", stock, err)
	}

	// Customer cancellation is pending-only. An admin may cancel a processing
	// order, and stock is restored exactly once.
	processingInput := data.CreateOrderInput{RecipientName: "B", Phone: "1", ShippingAddress: "A", Items: []data.OrderLineInput{{ProductID: 12, Quantity: 1}}}
	processingOrder, _, err := store.CreateOrder(ctx, 1, "e2f3b4c5-d6a7-4b8c-9d0e-1f2a3b4c5d6e", processingInput)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.UpdateOrderStatus(ctx, processingOrder.ID, "processing"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.CancelOrder(ctx, 1, processingOrder.ID); err != repository.ErrInvalidOrderTransition {
		t.Fatalf("customer must only cancel pending orders, got %v", err)
	}
	if err = lease.conn.QueryRowContext(ctx, `SELECT stock FROM products WHERE id=12`).Scan(&stock); err != nil || stock != 1 {
		t.Fatalf("rejected customer cancellation must not restore stock: stock=%d err=%v", stock, err)
	}
	if _, err = store.UpdateOrderStatus(ctx, processingOrder.ID, "cancelled"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.UpdateOrderStatus(ctx, processingOrder.ID, "cancelled"); err != nil {
		t.Fatal(err)
	}
	if err = lease.conn.QueryRowContext(ctx, `SELECT stock FROM products WHERE id=12`).Scan(&stock); err != nil || stock != 2 {
		t.Fatalf("processing cancellation should restore stock once: stock=%d err=%v", stock, err)
	}

	var adminOrderID int64
	if err = lease.conn.QueryRowContext(ctx, `SELECT id FROM orders WHERE status='pending' ORDER BY id DESC LIMIT 1`).Scan(&adminOrderID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.UpdateOrderStatus(ctx, adminOrderID, "processing"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.UpdateOrderStatus(ctx, adminOrderID, "shipped"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.UpdateOrderStatus(ctx, adminOrderID, "completed"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.UpdateOrderStatus(ctx, adminOrderID, "cancelled"); err != repository.ErrInvalidOrderTransition {
		t.Fatalf("completed order cancellation should fail: %v", err)
	}
	if _, total, listErr := store.ListOrders(ctx, 1, 1, 1); listErr != nil || total < 1 {
		t.Fatalf("pagination total=%d err=%v", total, listErr)
	}
	// The first order owns the immutable "snapshot name" item and is cancelled
	// above; use its actual terminal state so this checks search + status together.
	if _, total, listErr := store.AdminOrdersFiltered(ctx, 1, 20, data.OrderFilter{Status: "cancelled", Query: "snapshot"}); listErr != nil || total != 1 {
		t.Fatalf("admin filter total=%d err=%v", total, listErr)
	}
	if err = lease.assertWritable(ctx); err != nil {
		t.Fatalf("integration schema lifecycle lost lock or schema after operations: %v", err)
	}
}

// TestIntegrationSessionGuardFailsClosed proves the guard predicate refuses a
// wrong schema, a lock owned by another session, and a missing lock.
func TestIntegrationSessionGuardFailsClosed(t *testing.T) {
	owner := sql.NullInt64{Int64: 41, Valid: true}
	other := sql.NullInt64{Int64: 42, Valid: true}
	missing := sql.NullInt64{}
	cases := []struct {
		name         string
		schema       string
		connectionID sql.NullInt64
		lockOwner    sql.NullInt64
		wantErr      bool
	}{
		{name: "owned lock and expected schema", schema: integrationSchemaName, connectionID: owner, lockOwner: owner},
		{name: "wrong schema", schema: "another_schema", connectionID: owner, lockOwner: owner, wantErr: true},
		{name: "lock held by another session", schema: integrationSchemaName, connectionID: owner, lockOwner: other, wantErr: true},
		{name: "lock not held", schema: integrationSchemaName, connectionID: owner, lockOwner: missing, wantErr: true},
		{name: "unknown connection", schema: integrationSchemaName, connectionID: missing, lockOwner: owner, wantErr: true},
	}
	for _, current := range cases {
		t.Run(current.name, func(t *testing.T) {
			err := integrationSessionReady(current.schema, integrationSchemaName, current.connectionID, current.lockOwner)
			if (err != nil) != current.wantErr {
				t.Fatalf("integrationSessionReady() error = %v, wantErr %v", err, current.wantErr)
			}
		})
	}
}

func TestIntegrationMySQLRequiresExplicitIsolatedOptIn(t *testing.T) {
	for _, value := range []string{"", "0", "true", "yes"} {
		if integrationMySQLTestOptInEnabled(value) {
			t.Errorf("integration opt-in accepted %q", value)
		}
	}
	if !integrationMySQLTestOptInEnabled("1") {
		t.Fatal("explicit opt-in value 1 should be accepted")
	}
}

// TestIntegrationLeaseRefusesWritesAfterPinnedConnectionLoss proves that once
// the lock session is gone, the guard and fixture DDL path refuse to write.
func TestIntegrationLeaseRefusesWritesAfterPinnedConnectionLoss(t *testing.T) {
	db := integrationDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	lease, err := tryAcquireIntegrationLease(ctx, db, integrationLockWaitSeconds)
	if err != nil {
		t.Fatal(err)
	}
	// Closing the *sql.DB after the held connection is returned to the pool
	// guarantees any advisory lock still attached to that session is released.
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close integration DB after simulated session loss: %v", err)
		}
	})
	if err = lease.conn.Close(); err != nil {
		t.Fatalf("close pinned lock connection: %v", err)
	}
	if err = lease.assertWritable(ctx); err == nil {
		t.Fatal("guard accepted a closed lock connection")
	}
	if err = lease.createTrackedTable(ctx, "users", integrationTableStatement("users")); err == nil {
		t.Fatal("created a table after the pinned lock connection was lost")
	}
	var exists bool
	if err = db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'users')`).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		t.Fatal("a write reached the database after the pinned lock connection was lost")
	}
}

// TestIntegrationSchemaRefusesPreexistingTables proves that an existing table
// and its data are left untouched. The sentinel table is created through the
// lease and preserved when setup refuses the non-fresh schema. Reprovision the
// dedicated schema externally before a later integration run.
func TestIntegrationSchemaRefusesPreexistingTables(t *testing.T) {
	db := integrationDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	lease := acquireIntegrationLease(t, db)
	if err := lease.createTrackedTable(ctx, "users", integrationTableStatement("users")); err != nil {
		t.Fatalf("create sentinel users table: %v", err)
	}
	if err := lease.assertWritable(ctx); err != nil {
		t.Fatalf("before sentinel seed: %v", err)
	}
	if _, err := lease.conn.ExecContext(ctx, `INSERT INTO users(id,username) VALUES (99,'preexisting')`); err != nil {
		t.Fatalf("seed sentinel row: %v", err)
	}
	if err := lease.setup(ctx); err == nil {
		t.Fatal("setup accepted a schema with a pre-existing required table")
	}

	var username string
	if err := lease.conn.QueryRowContext(ctx, `SELECT username FROM users WHERE id=99`).Scan(&username); err != nil {
		t.Fatalf("pre-existing table or data was modified: %v", err)
	}
	if username != "preexisting" {
		t.Fatalf("pre-existing data changed to %q", username)
	}
	for _, table := range integrationTableNames() {
		if table == "users" {
			continue
		}
		exists, err := lease.tableExists(ctx, table)
		if err != nil {
			t.Fatal(err)
		}
		if exists {
			t.Errorf("setup created %q despite refusing a non-fresh schema", table)
		}
	}
}

// TestIntegrationSchemaLockIsExclusive proves a concurrent process cannot
// acquire the same schema while another test owns it, and a failed contender
// does not disturb the owner's lock.
func TestIntegrationSchemaLockIsExclusive(t *testing.T) {
	db := integrationDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	first := acquireIntegrationLease(t, db)
	if err := first.assertWritable(ctx); err != nil {
		t.Fatalf("owner cannot confirm advisory lock: %v", err)
	}
	second, err := tryAcquireIntegrationLease(ctx, db, 0)
	if err == nil {
		_ = second.releaseLock(ctx)
		_ = second.conn.Close()
		t.Fatal("a second connection acquired an already-held schema lock")
	}
	if err := first.assertWritable(ctx); err != nil {
		t.Fatalf("failed contender disturbed the owner's lock: %v", err)
	}
	for _, table := range integrationTableNames() {
		exists, err := first.tableExists(ctx, table)
		if err != nil {
			t.Fatal(err)
		}
		if exists {
			t.Errorf("lock contender created table %q", table)
		}
	}
}
