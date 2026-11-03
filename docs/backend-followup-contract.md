# Backend follow-up contract proposal

**Status:** proposal only; no backend source, migrations, configuration, or database were changed. Rechecked against commit `1592d7121b189639491c99cf505a83e4d28abbf0`. Preserve Route → Controller → Service → Model, frontend compatibility, and backend agent ownership rules. User-approved facts: discount times use UTC+07:00; product codes are server-generated, unique, alphanumeric, and editable by authorized admin; stock is admin-managed; COD remains the only payment method. Proposed routes/schema below are not approved or implemented. Remaining policy decisions are listed at the end.

## Existing backend surface (confirmed)

The API is Go/Gin under `/api/v1`, with JSON DTOs in `backend/data`, repository interfaces under `backend/controller/repository`, SQL persistence in `backend/model`, and inline `{ "error": "..." }` error bodies. Authentication uses `Authorization: Bearer <JWT>`; middleware checks the token and roles (`customer` or `admin`). Admin routes are role-protected. MySQL is InnoDB; migration SQL is embedded and applied at API startup (`backend/main.go`), with migrations mounted into MySQL initialization in Compose. Migration `006` is present. There are no delivery settings, product price schedules, or stock-adjustment endpoint. COD payment metadata is present for orders.

| Existing route | Auth | Existing behavior relevant to proposal |
|---|---|---|
| `GET /api/v1/products`, `GET /api/v1/products/:productID` | Public | Active products only. Product currently returns `id, sku, name, description, imageUrl, images, priceVnd, stock, isActive, categories`. |
| `GET /api/v1/admin/products` | Admin | Includes inactive products. |
| `POST /api/v1/admin/products`, `PUT /api/v1/admin/products/:productID` | Admin | Full-replacement DTO requires client-provided `sku`, `name`, `priceVnd`, `stock`; supports `description`, `imageUrl`, `imageUrls`, `categoryIds`. SKU unique constraint exists. Create/update transactionally replace category/image associations, but update also sets stock directly and has no optimistic version check. Product controller currently maps any create/update repository error to `409`, even if it is not a duplicate SKU. |
| `DELETE /api/v1/admin/products/:productID` | Admin | Hard delete; product-category and product-image associations cascade. `order_items.product_id` has no FK, so existing order item snapshots do not prevent product deletion. |
| `POST /api/v1/admin/product-images` | Admin | Multipart field `images`, 1–10 images, 8 MiB per image, 50 MiB total request; verifies JPEG/PNG/WebP/GIF header, creates random filenames and returns `{ "items": ["/uploads/..."] }`. Static `/uploads` path is public. |
| `POST /api/v1/orders` | Customer | Checkout accepts recipient name, phone, shipping address, and 1–100 product/quantity lines (`quantity` 1–99). It requires a UUID `Idempotency-Key`; duplicate product IDs are rejected. Server uses product `price_vnd`, snapshots product name/unit price, records `payment_method='cod'`, decrements stock, creates order/items and associates the idempotency record in one transaction. Stock/product failures return `409`; same customer/key/canonical payload replays prior order (`200`, `Idempotency-Replayed: true`), while key reuse with a changed payload returns `409`. First success is `201`. |
| `GET /api/v1/orders?page=1&pageSize=20` | Customer | Returns `{items,page,pageSize,total}` for only the authenticated customer; page size 1–100. |
| `GET /api/v1/orders/:orderID`, `POST /api/v1/orders/:orderID/cancel` | Customer | Detail is owner-scoped; missing/foreign order is `404`. Customer may cancel only pending orders; repeated cancellation returns the order without restoring stock twice; invalid transition is `409`. Stock restore and status transition are transactional. |
| `GET /api/v1/admin/orders?page=1&pageSize=20&status=&q=` | Admin | Returns paginated `{items,page,pageSize,total}`; optional validated status and text query, with page size 1–100. |
| `GET /api/v1/admin/orders/:orderID`, `PATCH /api/v1/admin/orders/:orderID/status` | Admin | Detail includes immutable item snapshots. Status request is `{ "status": "..." }`; allowed transitions are `pending → processing|cancelled`, `processing → shipped|cancelled`, `shipped → completed`. Repeating the current status is idempotent; cancel restores stock exactly once in the same transaction; illegal transitions return `409`. `paid` is recognized for legacy rows/filtering but is not a mutation target. |
| `GET /api/v1/categories`, admin category CRUD | Public read / Admin write | Categories are generic. Migration 003 seeds `Giò chả` and `Pa-tê`; `product_categories` permits multiple categories per product. |
| `POST /api/v1/contacts`, `GET|DELETE /api/v1/admin/contacts...` | Public create / Admin read-delete | Contact records are not delivery configuration. |

Existing SQL: `products` has `sku VARCHAR(64)` unique, `price_vnd BIGINT`, `stock INT`, active and timestamps (`001_init.sql`). Orders store total, status, recipient/address, `created_at`, and now `payment_method VARCHAR(16) NOT NULL DEFAULT 'cod'` via migration 006; order items preserve product name, quantity and unit price, but have no product FK (`001_init.sql`). `order_idempotency` uses `(user_id INT, idempotency_key CHAR(36))` primary key, request SHA-256 hash, nullable unique order ID and cascading user/order FKs (`006_checkout_orders.sql`). Categories and product-image relation are in migrations 003–004. The migration runner verifies tables, declared column type/length/nullability and FK mappings before baseline/mark-applied, and has narrowly scoped recovery for duplicate `orders.payment_method` when replaying the exact migration statement. It splits SQL statements while respecting quoted strings/comments. Migration DDL is not transactionally wrapped; migration 006’s `ALTER TABLE` and table creation can partially succeed, with startup verifying/repairing the expected schema before recording the version. For further proposals, use the next migration version; do not rewrite migrations 001–006 for deployed databases.

## Recommended proposed API / DTO contract

All endpoints below are **proposals**. Existing routes remain compatible where possible: retain the current fields, add response fields, and maintain `priceVnd` as the currently effective customer-facing price. Admin product writes should become a deliberate versioned contract rather than silently trusting client stock/SKU data.

### Product representation and catalog groups

Proposed `Product` additions (not fields in the existing DTO):

```json
{
  "sku": "<server-generated-alphanumeric-code>",
  "priceVnd": 45000,
  "regularPriceVnd": 50000,
  "discountPriceVnd": 45000,
  "discountStartsAt": "2026-11-03T00:00:00+07:00",
  "discountEndsAt": "2026-11-10T00:00:00+07:00",
  "priceEffectiveAt": "2026-11-03T10:30:00+07:00",
  "stock": 20,
  "stockVersion": 3
}
```

`priceVnd` would be the effective amount at response time, computed server-side from the regular amount and active discount window; schedule metadata is also returned for the admin UI. The user-approved store timezone is UTC+07:00; storage and API boundary representation still need definition. Product group is represented using existing categories and `categories` response structure. Candidate groups are `pâté`, `bánh mì`, `sauces`, `giò lụa`, `giò tai`, `thịt nguội` with stable normalized slugs. Confirm exact display spellings/slug policy and multi-category behavior; existing relation is many-to-many.

### Product create/update

Proposed `POST /api/v1/admin/products` request (admin bearer required). This changes the existing required client `sku`, `priceVnd`, and `stock` input contract, so release compatibility must be planned:

```json
{
  "name": "Bánh mì pate",
  "description": "...",
  "imageUrl": "/uploads/abc.jpg",
  "imageUrls": ["/uploads/abc.jpg"],
  "regularPriceVnd": 50000,
  "discountPriceVnd": 45000,
  "discountStartsAt": "2026-11-03T00:00:00+07:00",
  "discountEndsAt": "2026-11-10T00:00:00+07:00",
  "stock": 0,
  "categoryIds": [1]
}
```

Proposed response `201` is full Product representation with server-generated `sku`, IDs, `isActive`, categories/images and effective price. **Do not accept SKU on create**: generate it on the server, retry generation on a unique-key collision, and return it. `PUT /api/v1/admin/products/:productID` is a full replacement for descriptive fields, prices/schedule, categories/images and active state, but should **not** change stock; use explicit stock endpoint below. `sku` may be present as an editable admin field on update only. Require a `stockVersion` only if the UI sends stock edits through a replacement path, otherwise keep inventory changes separate. Consider `PATCH` later; do not redefine PUT as partial.

Recommended validation: trim required text; reject blank names; preserve `priceVnd` as integer VND; all regular/discount prices positive; if discount fields are supplied they must be complete (both price and interval), discount amount strictly below regular, end strictly after start; require existing category IDs and reject duplicates; enforce current DB lengths; image references must be valid local `/uploads/<generated-name>` paths or approved HTTPS URL if external images are still supported. Never trust a client-supplied effective price. Define `isActive` explicitly if product activation is needed (currently DTO does not expose it on writes although SQL does).

### Product code generation

Requirement is server-generated unique alphanumeric code on create and later admin-editable. One illustrative format recommendation is uppercase `TK` prefix plus 10 cryptographically random base-36 characters (`TK` + `[A-Z0-9]{10}`), no separator. Keep the unique database index as final arbiter. Collision: bounded generation retry; admin edit collision returns `409 SKU_CONFLICT`. Admin update validates an approved alphanumeric pattern and max length. **Exact pattern/prefix/length and normalization policy need approval; editability is already approved.** Product code is not an authorization secret or primary key.

### Stock management

User-approved requirement: admin can manage stock. Proposed `POST /api/v1/admin/products/:productID/stock-adjustments` (admin bearer):

```json
{ "delta": -2, "reason": "damaged", "idempotencyKey": "optional-client-generated-uuid" }
```

Response `200`: `{ "productId": 1, "stock": 18, "stockVersion": 4 }`. Positive and negative signed integer deltas; reject zero, negative resulting stock, overflow and missing product. Use InnoDB transaction, `SELECT ... FOR UPDATE`, apply change and insert immutable audit row atomically; optionally support a separate audited `PUT .../stock` absolute set with required `expectedStockVersion` to prevent stale overwrite. **Approval needed: adjustment versus absolute set and audit retention/actor/reason policy.** Recommend adjustment endpoint with required reason and actor audit; reserve a version-checked set endpoint only for reconciliation. Include unique idempotency key if retries are likely.

### Checkout, COD and pricing snapshot

Existing customer `POST /api/v1/orders` already requires a UUID `Idempotency-Key` header and accepts `{recipientName, phone, shippingAddress, items:[{productId, quantity}]}`. The body has no payment-method, price, or total input; the backend assigns `paymentMethod: "cod"`. `Order` responses already include `paymentMethod`, total, status, recipient fields, item snapshots, and `createdAt`. Proposed discount support should retain this trust boundary and existing idempotency contract: no client-submitted prices/totals, preserve `unitPriceVnd` as the charged unit price and snapshot any additional regular/discount metadata only if approved. Keep COD in the order record and existing response; there is no need to request a payment method unless policy changes. First success/replay statuses and response header remain as described in Existing backend surface.

Inside the existing order transaction, current implementation already locks distinct product rows sorted ascending, rejects duplicate product IDs, validates active status and available stock, checks amount overflow, conditionally decrements stock, and commits order/idempotency/item records together. On discount support, retain those safeguards; obtain one server `now` instant for all product price decisions, calculate effective scheduled prices from server data, and store the charged price in `unitPriceVnd` plus approved price snapshots. Do not add another idempotency mechanism: `order_idempotency` already enforces customer-scoped UUID replay and payload conflict. Product price changes between a failed attempt and a new key are expected to use the then-current price; replay returns the original order snapshot.

Existing errors use `{ "error": "..." }`: missing/malformed UUID key is `400`; duplicate product or invalid input is `400`; unavailable/inactive/out-of-stock product is `409`; changed-payload idempotency reuse is `409`; unexpected persistence failure is `500` with a generic controller message. Future additions may introduce stable error codes without removing the existing `error` field, but should preserve these established status behaviors and the `Idempotency-Replayed` response header. Never decrement inventory on failed order; SQL transaction rollback guarantees no partial order/stock update.

### Delivery information

Existing `/contacts` are user-submitted contact records, not store delivery settings. Proposed admin-only singleton API:

- `GET /api/v1/admin/settings/delivery` → `{ "phone": "...", "address": "...", "mapLocation": "...", "deliveryText": "...", "updatedAt": "...", "version": 1 }`.
- `PUT /api/v1/admin/settings/delivery` with same editable fields plus `expectedVersion`; returns updated representation. Reject stale version with `409 VERSION_CONFLICT`.
- Public `GET /api/v1/delivery-info` only if public display is required.

Recommend initially informational (display-only), not authoritative shipping calculation or service-area validation; checkout still captures a customer-provided shipping address and no delivery fee is computed. **Approval needed on informational vs operational role, exact fields, and public exposure.** Store one row under a singleton key with optimistic versioning; no secrets in public response.

## Validation, auth and error contract

- Continue bearer JWT and role middleware. Product read and public delivery-info are public; checkout requires customer role; product, stock, image upload, and delivery-settings writes/reads requiring sensitive details require admin role. Existing contact creation remains public; contact listing/deletion are admin-only.
- Request JSON must be bounded, parse strictly, and reject unknown/malformed fields where practical. All product/price/stock values are integer VND/counts; reject negative values and overflow. Validate IDs as positive. Existing checkout requires 1–100 lines, quantities 1–99, and rejects duplicate product IDs (do not describe aggregation as current behavior).
- Preserve current `{ "error": "human readable message" }` bodies; an additive stable machine code is proposed as `{ "error": "...", "code": "VALIDATION_ERROR", "details": {...} }`. Proposed statuses: `400` malformed/invalid; `401` missing/invalid token; `403` role insufficient; `404` absent product/settings; `409` unique/version/stock/idempotency conflict; `413` upload size; `415` unsupported image media; `422` semantically invalid discount/schedule; `500` internal failure without SQL/file paths. Existing product create/update currently map any repository failure to `409`, so a follow-up should distinguish duplicate SKU from storage/server errors without changing established client expectations unintentionally.
- Return no stack traces, SQL errors, local filesystem paths, or JWT content. Use stable error codes so frontend behavior does not depend on English text.

## Time semantics (approval required)

The user-approved store timezone is **UTC+07:00** for discount schedule entry/display. Proposed inputs are RFC3339 timestamps with an explicit offset; convert to UTC instants before persistence in `DATETIME(6)` (MySQL DATETIME has no timezone). API may return canonical UTC `Z`, rendered in UTC+07:00 by the UI. Still decide boundary convention (recommend half-open `[start,end)`: active for `now >= start && now < end`) and canonical serialization. Capture one `now` per request/order to avoid boundary drift. Ensure DB driver/session timezone is configured consistently; DATETIME is not self-describing.

## Upload contract and storage safety (approval required)

Current limits are 10 images, 8 MiB/file, 50 MiB total; JPEG/PNG/WebP/GIF are accepted by magic-byte detection, random 128-bit filename, and public static serving. Proposed behavior can retain these limits initially and return existing `201 {items:[...]}`. **Approval needed on limits and GIF allowance**; safe recommended default for a storefront is 10 images, 8 MiB each, 50 MiB request, JPEG/PNG/WebP only, with image decoding/dimension and decompression-bomb checks (not merely header check). Add cleanup for partially persisted files on errors and orphan cleanup for uploaded images never attached to a product; deleting/replacing product associations currently does not delete files. Treat filenames as server-generated and never accept arbitrary destination paths. If uploads are public, document URL exposure and ensure storage is durable/shared in multi-instance deployment; current Compose uses a named volume. Consider storage outside web root or CDN once operational needs justify it.

## Proposed schema/migration and rollback concerns

Create a new migration version (next available is `007`), do not alter 001–006. Likely additive changes:

1. `products`: add `regular_price_vnd BIGINT NULL` initially, `discount_price_vnd BIGINT NULL`, `discount_starts_at DATETIME(6) NULL`, `discount_ends_at DATETIME(6) NULL`, and `stock_version BIGINT NOT NULL DEFAULT 0` (plus optional `sku` pattern is application validation; existing unique index remains). Backfill `regular_price_vnd = price_vnd`; retain `price_vnd` during compatibility transition, define synchronization and avoid two competing sources of truth. Safer long-term is make `regular_price_vnd` canonical and keep `price_vnd` as legacy mirror temporarily, then remove legacy only in a later migration after all clients are upgraded.
2. `orders`: COD metadata already exists from migration 006 (`payment_method VARCHAR(16) NOT NULL DEFAULT 'cod'`). Do not add it again. If order-price snapshots need extension, add only those new columns with a documented backfill. Idempotency already lives in `order_idempotency`; do not duplicate it in `orders`.
3. `order_items`: add `regular_unit_price_vnd BIGINT NULL` and/or discount snapshot columns if audit/reporting requires historic discount details. Backfill regular unit price from existing `unit_price_vnd` (prior orders had no discounts).
4. New `stock_adjustments` audit table: ID, product ID, delta, before/after stock, reason, admin user ID, idempotency key, created timestamp; index product/time and unique idempotency key scope. Decide FK delete behavior: `ON DELETE RESTRICT` protects audit history; this implies soft-delete products rather than existing hard delete.
5. New singleton `store_settings` or dedicated `delivery_settings` table with fields and optimistic `version`; constrain singleton key.

Before applying, inspect populated production schemas/data, back up, verify duplicate codes and amount ranges, and estimate table-lock/DDL time. MySQL 8 online DDL capability varies by operation and table; do not assume zero-lock. The current runner has schema readiness checks for declared tables, columns and foreign keys; migration SQL is not transactionally wrapped, and a narrowly handled duplicate-column recovery exists only for the exact `006` payment-column statement. For migration 007, declare and verify every required table/column/FK and ensure restart after partial DDL is safe; test fresh install and upgrade/baseline paths against a dedicated disposable schema. Do not claim the current runner only checks table existence: it verifies migration metadata specified in `migrationPlan`. Index readiness is not separately declared/verified by the current migration metadata.

Rollback is not simply dropping columns after writes begin. Plan forward-compatible expand/backfill/read-switch/contract phases; retain old `price_vnd` and new snapshots until rollback window closes. Before rollback of added tables/columns, export audit/history and confirm no application version still reads them. Reverting a stock or price migration cannot restore overwritten inventory/prices; preserve audit/backups. Delivery settings can be exported before removal. Do not run DDL as part of proposal work.

## Approval decisions

| Decision | Safe recommendation | Status |
|---|---|---|
| Discount meaning | `discountPriceVnd` absolute sale amount, with regular price and explicit start/end; effective price server-calculated. | Approval required |
| Store timezone | UTC+07:00 for discount schedule entry/display. | Approved |
| Time boundaries/serialization | Persist UTC instants; RFC3339 explicit-offset input; half-open `[start,end)`; canonical UTC `Z` rendered in UTC+07:00. | Boundary and serialization convention require confirmation |
| Product-code behavior | Server-generated, unique, alphanumeric; editable by authorized admin; unique check on create and edit. | Approved |
| Exact generated SKU pattern | `TK` + 10 uppercase cryptographically random alphanumeric chars, no separator. | Approval required |
| Stock API and audit | Signed adjustment with reason and actor audit; optional idempotency key; separate expected-version absolute set only for reconciliation. | Approval required |
| Image limits and formats | Keep 10 files / 8 MiB each / 50 MiB aggregate; JPEG/PNG/WebP only; decode and dimension checks. | Approval required |
| Delivery settings role | Informational display only, not rate/service-area calculation; public-safe subset only if storefront needs it. | Approval required |
| Product groups | Seed six named groups as categories; confirm spelling/slugs and whether products can be multi-group. | Approval required |
