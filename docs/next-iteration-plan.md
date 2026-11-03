# Tuấn Khang Storefront — Implementation Plan

## Approved requirements

- Store identity: Tuấn Khang; modern Vietnamese food storefront.
- Catalog groups: pâté, bánh mì, sauces/nước sốt, giò lụa, giò tai, thịt nguội.
- Main storefront navigation; detailed product page with multi-image gallery/slider.
- Customer login omits the storefront main menu.
- COD only; do not add online payment.
- Products have regular and discounted prices, with discount start/end times in UTC+07:00.
- Product code is server-generated, unique, alphanumeric (letters and digits), and may be edited by an authorized admin. Exact code pattern is not specified.
- Admin can upload product images, edit delivery information, and manage stock.
- Clearly marked demo images may be used for layout; replace with approved/licensed product photos before launch.
- Preserve Checkout & Orders behavior: server-calculated price, idempotent checkout, order price snapshots, stock transaction, cancellation restoration, role and ownership enforcement.

## Baseline

- `origin/main`: `1592d7121b189639491c99cf505a83e4d28abbf0` (Checkout & Orders PR #3).
- Do not use uncommitted changes from the divergent `feature/checkout-orders-reviewed` worktree.
- No destructive database actions. MySQL integration tests require verified isolated disposable schemas; see `docs/checkout-orders-integration-qa.md`.
- No implementation worktree may merge or deploy. The user requested a PR, not a merge.

## Parallel work assignment

### Frontend (`feature/tuan-khang-frontend`)

- Storefront visual direction, navigation/catalog filters, accessible product gallery, login without main menu, COD messaging, clearly marked placeholders.
- Keep using current API and do not fake persistence for unimplemented discount schedules, delivery settings, SKU editing or stock adjustment.
- Tests/checks: `npm test`, lint, format check, TypeScript, build.

### Backend (`feature/tuan-khang-backend`)

- First produce a contract proposal matching the approved facts. Existing source is under `backend/data`, `backend/controller`, `backend/model`, `backend/route`, migrations, and product-image upload controller.
- Do not implement migrations or new business rules until the open decisions are approved.
- Existing product API accepts `sku`, `priceVnd`, `stock`; order creation calculates current price server-side and decrements stock transactionally. Existing upload: multipart `images`, up to 10 files, 8 MiB each, 50 MiB total, JPEG/PNG/WebP/GIF header validation.
- After decisions: add API/model/migration/tests only with reviewed compatibility and rollback plan.

### Integration/QA (`tuan-khang-integration`)

- Reconcile frontend changes and backend proposal, review API/data assumptions, preserve independent QA.
- Review accessibility, privacy, upload safety, discounts, generated/editable SKU, stock concurrency vs checkout/cancel, COD and delivery info.
- Run tests and record exact outputs; never claim skipped MySQL tests passed.

## Backend contract decisions

**Approved 2026-11-03:** implement recommendations in `docs/backend-followup-contract.md`: absolute discount price with half-open `[start,end)` in UTC+07:00 (UTC persistence, canonical `Z` response); generated `TK` + 10 uppercase alphanumeric SKU editable by admin; signed stock adjustments with required reason/admin actor audit and optional idempotency; informational admin-only delivery settings with optimistic versioning and no fee calculation.

1. Image upload formats/limits, dimension/decompression validation, reorder/remove/primary behavior and production asset provenance.
2. Category display labels/slugs, seeding method, and approved real products/assignments.
3. Public delivery-information endpoint is not approved; delivery API remains admin-only.

Keep COD and UTC+07:00 as fixed requirements. `docs/backend-followup-contract.md` is approved for the decisions identified above; image policy and product catalog content remain open.

## PR sequence

1. Review and integrate the UI slice on its isolated branch after QA.
2. Implement backend only after resolving the choices above, then test contract compatibility.
3. Create a PR targeting `main` from the integrated feature branch. Include remaining risks and tests; do not merge.
