# Checkout / orders integration contract and QA plan

## Scope and branch dependency

This QA plan accompanies the integrated checkout/orders changes on `feature/checkout-orders-assembly`. Automated Go and frontend checks have been run; neither MySQL suite is considered executed unless explicitly reported with isolated database evidence.

## Agreed API behavior to verify

- Checkout creates a pending order from the submitted recipient/shipping fields and item quantities; server-side product prices and stock determine line prices and total.
- A retry with the exact original checkout payload and idempotency key returns the original order/result and must not decrement stock or create a second order. Reusing a key with a changed payload is rejected without mutation. Key scope/retention and response status/body should be documented by the backend implementation.
- A customer can explicitly abandon a pending checkout and start a new checkout. Abandon/restart must not implicitly mutate an already committed order.
- Customer cancellation is allowed only while pending. Admin cancellation is allowed while pending or processing. The successful transition restores reserved stock exactly once, transactionally with the state change; repeated cancellation is an idempotent no-op. Terminal/unsupported transitions return a conflict and leave order and stock unchanged.
- Customer order reads are limited to the authenticated customer; admin order operations require the admin role. Unauthenticated, wrong-role, and cross-customer access are denied.

## Product SKU contract

The frontend treats SKU as a server-provided string and does not mandate its exact syntax. Use `<server-generated-alphanumeric-code>` as a placeholder in examples until the format is approved. `TK` followed by 10 alphanumeric characters is only an illustrative recommendation, not an agreed contract; obtain explicit product/backend owner approval before implementing or enforcing that format.

## Safe database test gate (mandatory)

Never point tests at the normal development or production database. Provision a disposable MySQL server isolated from all non-test systems, and use a dedicated disposable schema per suite. Both suites require `CHECKOUT_MYSQL_TEST_ISOLATED=1` plus a suite-specific DSN:

- Migration runner: `CHECKOUT_MIGRATION_TEST_DATABASE_URL`, schema `checkout_orders_migration_test`.
- Checkout/order lifecycle: `CHECKOUT_TEST_DATABASE_URL`, schema `checkout_orders_test`.

The opt-in is an operator assertion, not proof by itself. Before setting it, verify the DSN endpoint is the disposable test server and the schema is dedicated to that suite. Each suite pins a connection, takes a MySQL advisory lock, validates exact schema identity, and fails closed unless the schema contains no tables. The suites use different schemas and locks and must not share a schema. A failure can leave objects/data for diagnosis; test cleanup never drops tables or rows. Reprovision the disposable database externally before rerunning; never reset it from application tests or remove volumes from a database that may contain retained data. If endpoint isolation, schema identity, lock ownership, or empty-schema status cannot be verified, stop before DDL.

Migration 006 adds `orders.payment_method` and a separate idempotency mapping table; it does not drop/rebuild existing tables or remove existing data. The migration runner verifies expected table/column/FK definitions and records its version marker only once schema validation succeeds. Its isolated MySQL test applies twice and checks the schema/version state. This does not replace a production backup/rollout review. The checkout/order integration suite creates fixtures in its own dedicated schema and intentionally retains its tables/data at test end; provision a fresh disposable schema before a later run.

## E2E / integration scenarios

1. Provision isolated test services separately from the normal application Compose DB; wait for DB/Redis health and API `/healthz`. Verify frontend uses browser API `http://localhost:18080`, while its server-side internal API uses `http://api:8080`.
2. Register/sign in two customers and an admin. Verify CORS preflight from configured `WEB_ORIGIN` allows Authorization, Content-Type, and `Idempotency-Key` (plus the expected methods); a different origin must not receive an allow-origin header. For responses carrying headers the browser client needs to read, verify those headers are listed in `Access-Control-Expose-Headers` and are observable to browser code. Backend middleware currently emits the configured origin and handles OPTIONS; compose sets it to `WEB_ORIGIN` (default localhost:3000).
3. Create a checkout; assert persisted order/items/prices/total and stock decrement are consistent. Retry exact payload/key; assert same order and unchanged stock. Change payload with same key; assert rejection and unchanged state.
4. Exercise explicit abandon then new checkout. Verify no duplicate reservation or orphan visible order.
5. Cancel a pending order as customer; verify one stock restoration. Repeat cancellation and assert stock is restored only once. Try cancellation after processing as customer; reject with no stock mutation. Admin cancels pending and processing orders; verify restoration exactly once for each. A concurrent cancellation race test is not currently implemented; add it before treating race behavior as integration-verified.
6. Verify wrong-customer reads, wrong-role operations, unknown keys/orders, insufficient stock, invalid quantity, and invalid state transitions fail without partial order/stock mutation.
7. Restart API against the isolated DB and verify migration/schema state and order/idempotency behavior persist. Do not run `docker compose down -v` against any environment with retained data.

## Ownership / dependency handoff

| Work | Owner | Dependency |
| --- | --- | --- |
| Migration 006, checkout retry/key persistence, abandon/restart, cancellation transaction and routes | Backend checkout/orders branch | Must land before integrated verification |
| Customer/admin UI wiring and order-state presentation | Frontend checkout/orders branch | Contract above; backend routes |
| Isolated MySQL fixture + fail-closed schema preflight + migration tests | Backend test owner | Requires a separately provisioned disposable MySQL instance |
| Compose, CORS and cross-stack smoke/E2E | Integration/QA | Backend and frontend branches integrated |

## Baseline config review and checks

- Compose binds phpMyAdmin to loopback and defaults to host port 8082; README previously advertised 8081 and is corrected. MySQL and Redis are internal compose services; API is published on 18080, web on 3000.
- Compose passes `CORS_ORIGIN=${WEB_ORIGIN:-http://localhost:3000}`. Backend CORS implementation reflects this configured static origin (not the request origin), returns the preflight headers, and sets credentials. `WEB_ORIGIN` must be the exact browser origin, including scheme/port. This does not validate production proxy/topology.
- `docker compose config` is a static-only check; no database was started or contacted for this review.

## Reported npm audit assembly run (frontend lockfile, 2026-11-02)

An `npm audit --json` run reported during assembly returned 18 findings (15 moderate, 2 high, 1 critical; 707 dependency nodes counted). These are reported assembly-run results, not a verification of this branch or its current dependency tree. No audit result file or exact source snapshot was present in the available assembly history, so the input snapshot and result path cannot be identified here. No fix or lockfile change was applied; rerun the audit against the intended integrated lockfile before relying on these totals.

- **Prioritize remediation:** direct `next` is pinned to 16.1.0 and audit identifies multiple advisories, including high/critical entries. Audit reports a non-major fix to 16.4.3. Review compatibility and upgrade in a dedicated dependency change; do not assume each advisory applies to enabled features.
- **Transitive runtime risk:** `postcss` and `sharp` are reported through Next; audit marks PostCSS high and Sharp high. Confirm resolved versions and runtime exposure, then address through supported Next dependency updates.
- **Development-tooling moderate:** ESLint / `minimatch` / `typescript-eslint` dependency chain findings are moderate, primarily tooling. Audit suggests only major-version fixes for parts of this chain; schedule with lint config compatibility testing.
- Severity totals are npm's aggregate, not counts of independent root causes; one vulnerable dependency may map to multiple advisories. Re-run audit after dependency changes.
