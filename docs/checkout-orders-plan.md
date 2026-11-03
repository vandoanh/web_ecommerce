# Checkout & Orders MVP: Plan and Shared Contract

## Repository findings (verified)

- The project uses Go/Gin with MySQL and Redis plus a Next.js App Router frontend. Docker Compose has `db`, `redis`, `api`, `web`, and `phpmyadmin` services; see `docker-compose.yml`.
- The original schema stores `products.stock` as the inventory source, orders and immutable `order_items` snapshots in MySQL (`backend/migrations/001_init.sql`). Users use `INT` primary keys (`backend/migrations/002_users.sql`). Migration 006 adds COD payment metadata and customer-scoped idempotency (`backend/migrations/006_checkout_orders.sql`).
- The Go migration runner embeds and verifies migrations in `backend/main.go`; MySQL init also mounts the migration directory from Compose.
- Routes are registered in `backend/route/route.go`. Customer order operations require a customer token; admin operations require an admin token.
- Checkout uses the existing cart and checkout UI in `frontend/src/app/page.tsx`, with order requests in `frontend/src/lib/store.ts`. Customer list/detail live in `frontend/src/app/orders/`; admin list/detail live in `frontend/src/app/admin/orders/`.
- Route/controller tests are in `backend/controller/http_test.go`; model unit tests and gated DB tests are in `backend/model/order_test.go` and `backend/model/store_orders_integration_test.go`. Migration tests are in `backend/main_test.go`. Frontend tests use Vitest.
- Dedicated MySQL tests require `CHECKOUT_MYSQL_TEST_ISOLATED=1` plus a suite-specific DSN and exact schema: `CHECKOUT_TEST_DATABASE_URL` / `checkout_orders_test` for order integration, and `CHECKOUT_MIGRATION_TEST_DATABASE_URL` / `checkout_orders_migration_test` for migration verification. They require an operator-verified disposable MySQL endpoint and an empty dedicated schema. They create fixture/migration tables but never drop or recreate tables/data; provision a fresh disposable database externally before rerunning.
- Existing agent configuration is retained in the planning worktree `.opencode/agents/`: planner/reviewer use `openai/gpt-6-luna`; backend/frontend use `deepseek/deepseek-flash`. Both exact model IDs were confirmed available. This is configuration evidence, not attribution of past work to a model.
- At the time of this plan, implementation changes were uncommitted on `feature/checkout-orders-reviewed`, based at `db49aa4`; `main` remained untouched. Compose services were running in this feature worktree.

## Existing behavior versus MVP scope

The project already had cart/product/auth/admin foundations and a basic order model/schema. The MVP extends checkout with trusted price snapshots, idempotency, atomic stock updates, paginated customer/admin order operations, customer ownership, cancellation, and validated admin status transitions. It does not add online payment, separate inventory reservations, or editable order-line pricing after placement.

“Edit order” is constrained to validated status transitions. Recipient/product/price snapshots are immutable after creation to avoid changing the accepted purchase and inventory accounting.

## Shared API contract (implemented)

### Customer

- `POST /api/v1/orders` — bearer customer token; requires UUID `Idempotency-Key` and JSON `{recipientName, phone, shippingAddress, items:[{productId,quantity}]}`. Duplicate product IDs and invalid fields return `400`; unavailable stock returns `409`. First success returns `201` with an order; same customer/key/payload replay returns `200`, same key with different payload returns `409`. Prices, names, total, COD method, order rows and stock decrement are derived/committed transactionally by the backend. Header `Idempotency-Replayed: true` identifies replay.
- `GET /api/v1/orders?page=1&pageSize=20` — bearer customer token; returns `{items,page,pageSize,total}` and only that customer’s orders.
- `GET /api/v1/orders/:orderID` — bearer customer token; owner-scoped order with item snapshots; foreign/nonexistent orders return `404`.
- `POST /api/v1/orders/:orderID/cancel` — bearer customer token; pending-only. Safe repeated cancellation returns the cancelled order without restoring stock twice; invalid transition returns `409`.

### Admin

- `GET /api/v1/admin/orders?page=1&pageSize=20&status=&q=` — bearer admin token; paginated `{items,page,pageSize,total}` with optional validated status and text query.
- `GET /api/v1/admin/orders/:orderID` — bearer admin token; complete order and item snapshot for review.
- `PATCH /api/v1/admin/orders/:orderID/status` — bearer admin token; JSON `{status}`. Allowed transitions: `pending -> processing|cancelled`, `processing -> shipped|cancelled`, `shipped -> completed`. Cancellation restores stock transactionally and exactly once. Illegal transitions return `409`.

All routes preserve existing authentication middleware. No payment gateway or customer edits to accepted order snapshots are in scope.

## Workstreams and ownership

Implementation is already present in the current feature worktree; these ownership boundaries describe the implementation split and avoid cross-stream edits:

1. Backend Go: `backend/controller/**`, `backend/data/**`, `backend/model/**`, `backend/route/**`, `backend/main.go`, `backend/main_test.go`, `backend/migrations/006_checkout_orders.sql`.
2. Frontend: `frontend/src/app/page.tsx`, `frontend/src/app/orders/**`, `frontend/src/app/admin/orders/**`, `frontend/src/app/store.css`, `frontend/src/app/admin/admin.css`, `frontend/src/lib/checkout.ts`, `frontend/src/lib/store.ts` and corresponding frontend tests.
3. Integration/QA: `docs/checkout-orders-plan.md`, contract/review checks and gated integration verification. Compose is unchanged.

Dependencies: agree on this contract first; backend route/repository contracts and frontend client must match; DB-backed checks require the dedicated schemas above. No stream should own files owned by another.

## Acceptance criteria

- The backend uses server-side prices and immutable item snapshots; transactions prevent overselling and roll back stock/order writes together.
- UUID idempotency is customer-scoped; same-payload retries replay and changed payload conflicts without duplicate decrement/order.
- Duplicate product lines are rejected; customer ownership and admin authorization are enforced.
- Customer/admin list endpoints paginate; customer detail/cancel and admin detail/status work with lifecycle validation.
- Customer may cancel only pending orders; inventory restoration is safe under repeated/concurrent requests.
- Frontend checkout, history/detail, admin order list/detail/status use the shared contract and show loading/error states.
- Docker Compose configuration remains unchanged; no unverified changes reach `main`.

## Verification commands

```sh
cd backend && go test -race -count=1 ./... && go vet ./...
cd frontend && npm test && npm run lint && npx tsc --noEmit && npm run build
CHECKOUT_TEST_DATABASE_URL='<dedicated checkout_orders_test DSN>' go test -count=1 ./model -run TestCheckoutOrdersMySQLIntegration
CHECKOUT_MIGRATION_TEST_DATABASE_URL='<dedicated checkout_orders_migration_test DSN>' go test -count=1 . -run TestRunMigrationsAgainstDedicatedMySQL
docker compose config
docker compose up --build -d
curl -fsS http://localhost:18080/healthz
curl -fsSI http://localhost:3000
```

Do not point either gated DB variable at a normal development or production database. Before setting `CHECKOUT_MYSQL_TEST_ISOLATED=1`, verify the endpoint is disposable and isolated. Test cleanup leaves all created tables/data intact for diagnosis; reprovision externally before rerunning. MySQL tests were not run during this review unless separately recorded with environment evidence.

## Risks and outstanding checks

- The dedicated MySQL test DSNs are not configured by default; those tests must be reported skipped unless explicitly provisioned and run.
- Migration 006 is applied by MySQL init on a fresh data volume and verified by the Go runner for existing databases. Legacy schemas with partially created, malformed idempotency structures fail loudly rather than being silently accepted.
- Current checkout persists retry state in browser session storage; clearing the session during an uncertain request may lose the retry key.
- No commits, rebases, or merges are part of this plan; integration into `main` requires separate explicit authorization.
