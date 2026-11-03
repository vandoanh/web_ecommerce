# Tuấn Khang — Post-merge Risk Remediation Plan

## Purpose and baseline

This plan tracks the follow-up risks left open by storefront PR #4 and the checkout/orders work. Implementation status is tracked below. It is not authorization to change business policy, use unlicensed product photography, run destructive database commands, or deploy.

- Baseline: `origin/main` commit `3c5e3b76801990a7e8138f73d91c1fffc5cc3670` (PR #4 merge commit).
- Verified in the baseline worktree; do not use the modified `feature/checkout-orders-reviewed` worktree as a source.
- Preserve COD, checkout idempotency, server-calculated pricing, immutable order item snapshots, transactional stock reservation/restoration, authorization and order ownership constraints.
- Do not run MySQL integration tests until the disposable host and exact dedicated schema are verified. The application tests do not create/drop databases, but they create fixture tables and write test rows into `checkout_orders_test` and retain those fixtures afterward.

## Risk register and delivery order

### R1 — Requested product groups are missing from catalog data

**Observed state:** `backend/migrations/003_categories.sql` seeds only `Giò chả` (`gio-cha`) and `Pa-tê` (`pa-te`). `GET /api/v1/categories` returns persisted categories; the storefront (`frontend/src/lib/catalog.ts`) intentionally renders tabs only from API-backed categories and omits requested groups that do not exist. The admin can manage categories through the existing category routes/UI. Do not fabricate products or claim the six requested groups are available merely by adding empty category labels.

**Required groups:** pâté, bánh mì, sauces/nước sốt, giò lụa, giò tai, thịt nguội.

**Plan:**

1. Product/catalog owner reviews the exact Vietnamese labels, stable slugs, descriptions, and whether products can belong to multiple groups (the schema already supports many-to-many categories).
2. Choose how to create canonical category records: controlled admin setup using the existing category UI, or a reviewed additive seed migration. If migration seeding is chosen, make it idempotent and do not overwrite admin edits; define conflict behavior for existing names/slugs first.
3. Product owner supplies and approves actual catalog records and category assignments. Empty categories alone do not satisfy product availability.
4. Verify categories API response and storefront tabs against the six approved groups; verify arbitrary admin categories continue to be shown and product filtering continues to work.

**Acceptance:** API returns the six canonical categories with approved labels/slugs; each intended group has real, reviewed product assignments before it is promoted in launch content; storefront exposes existing API categories without hidden/unreachable categories; no invented product data.

**Owner/dependencies:** product/catalog owner + admin operator; backend only if an idempotent seed or data migration is approved; frontend QA after data setup.

**Implementation status:** Existing behavior retained; regression tests added to ensure missing groups stay omitted and arbitrary API/admin categories remain available. Actual catalog content still requires product-owner approval and setup.

### R2 — Demo image placeholders must be replaced with approved/licensed photos before launch

**Observed state:** `frontend/public/food-placeholder.svg` is an original, clearly labeled illustration, not a product photo. Storefront and product detail fall back to it for absent/broken product image URLs. It is acceptable for layout/demo only and must not be represented as real merchandise photography.

**Plan:**

1. Marketing/product owner provides image files or a sourcing list with documented license/permission, permitted commercial use, attribution requirements, territories, term, and any model/property releases relevant to the source.
2. Record provenance and approval per image (source URL/vendor, license or written authorization, acquisition date, product mapping, attribution/credit requirement, and expiry/renewal if applicable). Reject unknown-license assets and scraped search-result images.
3. Confirm technical image requirements and ownership of upload/hosting. Existing upload accepts 1–10 files, JPEG/PNG/WebP/GIF, 8 MiB/file, 50 MiB/request; verify a reviewed implementation's decoding/dimension validation and storage lifecycle before relying on it for production assets.
4. Upload/associate approved assets through the admin workflow; test primary/gallery ordering, responsive rendering, alt text, broken URL fallback and all product/category pages.
5. Keep explicit placeholder labels while any product lacks an approved photo. If launch requires all product photos, enforce a pre-launch inventory checklist and block launch until complete; do not silently substitute unlicensed photos.

**Acceptance:** every launch product image maps to a documented approved source; required attribution is present; no demo placeholder is mistaken for a real product image; missing assets are visibly labeled or the affected product is excluded from launch.

**Owner/dependencies:** marketing/product owner and legal/licensing approver provide assets and permissions; admin operator uploads; QA verifies mapping and fallback.

**Implementation status:** Frontend now synchronizes image fallback source, alt text, and visible label so failed product URLs are clearly shown as illustrative. No real product photos were supplied; licensed-image replacement remains blocked on approved assets.

### R3 — MySQL integration evidence and concurrent cancellation race coverage

**Observed state:** `backend/model/store_orders_integration_test.go` contains a gated lifecycle integration test, including concurrent checkout, sequential repeated cancellation, and stock restoration cases. It does **not** currently run two cancellations of the same order concurrently. The gate requires `CHECKOUT_MYSQL_TEST_ISOLATED=1`, `CHECKOUT_TEST_DATABASE_URL`, exact schema `checkout_orders_test`, an empty schema, and an exclusive advisory lock. Test fixtures are retained; this suite does not drop tables/rows. `docs/checkout-orders-integration-qa.md` documents a separate migration suite and the safety conditions.

**Plan:**

1. Test owner provisions a dedicated disposable MySQL service isolated from development/production, with a fresh, dedicated `checkout_orders_test` schema. Do not reuse normal Compose DB, a shared dev server, a production endpoint, or a schema with retained data.
2. Before any opt-in, independently verify the DSN host/port and credentials resolve to that disposable service, `SELECT DATABASE()` is exactly the required schema, and the schema contains no tables. Record non-secret evidence (service identity, schema name, timestamp, MySQL version); never paste credentials.
3. Add a deterministic race scenario to `TestCheckoutOrdersMySQLIntegration`: create one pending order, synchronize two goroutines to call `CancelOrder` for the same customer/order concurrently, collect both results, and assert both calls follow the defined idempotent cancellation contract, final status is cancelled, and stock is restored exactly once. Check for deadlocks/timeouts and use a bounded context. Keep fixture writes and assertions under the test's pinned schema lease; do not use global cleanup/reset commands.
4. Run the lifecycle suite against its verified isolated schema with only its required opt-ins; capture exact command, exit status, test names, MySQL version, and schema verification. Since fixtures persist, use a newly provisioned disposable schema for a repeat run rather than clearing it from test code.
5. Separately provision/verify `checkout_orders_migration_test` before running the migration suite. Never point both suites at the same schema. Report skips as skips, not passes.
6. Run unit tests and static checks independently. Do not claim MySQL verification until the DB suite has completed against the verified disposable service.

**Acceptance:** race coverage passes repeatedly on disposable MySQL; one and only one stock restoration occurs; order ends cancelled; both requests return according to the established repeated-cancel contract; exact environment evidence is retained without secrets; migration and lifecycle schema boundaries remain separate.

**Owner/dependencies:** backend test owner adds the race case; DB/operator owner provides isolated disposable MySQL and evidence; QA observes and records. Stop if any isolation, schema, emptiness, or lock check fails.

**Implementation status:** Added a barrier-synchronized, bounded concurrent cancellation scenario to `backend/model/store_orders_integration_test.go`. Unit/static tests are run separately; the MySQL race remains unverified until a disposable instance is provided and the gated suite actually passes.

### R4 — Backend product/commercial requirements are not implemented

**Observed baseline:** no product discount schedule, server-generated SKU flow, stock adjustment/audit API, or delivery-settings API was present in `backend/route/route.go`. Product create/update accepted client-supplied `sku`, `priceVnd`, and `stock`. Existing checkout charged server-side product pricing. Image upload also exists and remains separately gated for production image safety/licensing.

**Policy approval:** On 2026-11-03 the user confirmed the recommendations in `docs/backend-followup-contract.md` were reviewed and approved for merge to `main`. Implement exactly those choices; do not extend into unresolved image/category decisions.

1. **Discount (approved):** absolute `discountPriceVnd`; complete schedule; strictly positive and below regular price; half-open `[start,end)`; RFC3339 offset inputs, persist UTC and return canonical UTC `Z`, display in UTC+07:00.
2. **Product code (approved):** generate `TK` + 10 uppercase alphanumeric characters; unique; authorized admin can edit; bounded collision retry; preserve unchanged legacy codes for compatibility.
3. **Stock (approved):** signed adjustment, required reason and admin actor, immutable adjustment audit, non-negative result and optional idempotency key; product edits must not overwrite stock. Audit table scope is admin adjustments; orders/order_items represent checkout and cancellation movements.
4. **Delivery (approved):** admin-managed informational fields, optimistic version checking; no fee or service-area calculation, no public read route until separately requested. Keep COD.
5. **Images:** confirm approved formats/limits, decode/dimension/decompression protections, ordering/primary/remove behavior, cleanup/orphan policy, storage durability/access, and ownership/licensing metadata. Current upload limits/format are existing behavior, not a complete production image policy.

**Implementation:**

1. Backend owner updates the API contract and compatibility plan; additive migration(s) only, never rewrite migrations 001–006. Specify data backfill, rollout/rollback, error contract, ownership/authorization, and how old frontend clients behave.
2. Implement schema, DTOs, repository/model transactions and role-protected routes. Server calculates effective checkout price at one consistent instant; never trust client prices. Keep checkout idempotency, COD, snapshot prices, stock locking, cancellation restoration and authorization invariants.
3. Implement stock adjustment semantics under transactions that share/coordinate product-row locking with checkout/cancel; ensure admin cannot race inventory into invalid states and avoid direct stock writes through legacy product update.
4. Add unit/HTTP/model tests for validation, collisions, admin-only access, time boundaries/timezone conversion, stock concurrency/audit/idempotency, delivery visibility and price snapshots. Add migration verification/compatibility tests.
5. Frontend owner integrates only against the approved API; no fake local persistence or display of unsaved discount/delivery/stock state.
6. QA verifies fresh install and upgrade path, customer/admin roles, COD checkout, and regression invariants. Run the isolated MySQL suites only after R3's gate is met.

**Acceptance:** approved contracts reflected in docs/API/tests; server-generated unique editable alphanumeric codes; approved scheduled prices calculated server-side and snapshot on order; stock changes audited/consistent according to approved policy; delivery behavior exactly matches approved scope; no regression to COD, idempotency, stock or access invariants; migrations safe on fresh and existing installations.

**Owner/dependencies:** product/business owner resolves policies; backend owner writes contracts/implementation/migrations; frontend owner consumes approved API; QA and DB operator validate end-to-end. Do not begin Phase B until Phase A decisions are recorded.

**Implementation status:** Backend API/schema and admin frontend are implemented in the current feature worktree, including migration 007. Unit/backend and frontend checks pass. Actual migration execution, MySQL transaction/race behavior, and upgrade compatibility remain unverified until gated tests run against separately verified disposable schemas. Image production policy and category content remain unresolved/out of scope.

## Cross-cutting release gates

- Category records and actual product data approved and present through the public API.
- Licensed/authorized launch photography documented, uploaded, and checked; placeholders remain visibly marked until replaced.
- Backend contract decisions signed off and implementation/test evidence complete; unresolved decisions are not silently defaulted.
- Disposable MySQL isolation verified separately for each required schema; lifecycle and migration suites pass; concurrent cancellation race test passes. If no safe disposable DB is available, mark DB verification blocked and do not represent it as passed.
- Existing checkout/order unit and frontend checks pass; no secrets, production data, or destructive database operations used during QA.
- PR reviewed and approved; merge/deploy remain separate decisions.

## Suggested issue/PR breakdown

1. Catalog content approval + canonical categories/product assignments (data/admin operation or reviewed additive migration).
2. Image licensing/provenance inventory + approved image rollout (blocked on approved assets).
3. Backend policy decisions and API contract approval (no code until resolved).
4. Backend discount/SKU/stock/delivery implementation with additive migrations and regression tests.
5. Concurrent cancellation integration coverage and verified isolated MySQL test run (DB operator prerequisite).
6. Final QA/release checklist confirming all cross-cutting gates.
