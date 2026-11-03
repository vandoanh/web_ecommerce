# Tuấn Khang — cửa hàng giò chả & pa-tê (Go + Next.js)

A starter online shop with a product storefront, customer accounts, shopping cart, checkout, inventory tracking, and a role-protected admin area.

## Stack

- API: Go, Gin, MySQL, Redis, JSON REST, bcrypt password hashes, HS256 JWT.
- Web: Next.js App Router, React, TypeScript, Tailwind CSS.
- Database: MySQL 8.0.16+ is the supported baseline; Compose uses MySQL 8.4. Migration 007 declares `CHECK` constraints, which MySQL only enforces from 8.0.16, and also uses a unique generated singleton column so single-row settings stay protected even if a server parses but ignores `CHECK`.
- Roles and groups: customers receive the `customer` role and `customers` group; the configured store administrator receives the `admin` role and `administrators` group.

## Run locally

1. Copy `.env.example` to `.env` and set a private `JWT_SECRET` and `ADMIN_PASSWORD`.
2. Run `docker compose up --build`.
3. Open `http://localhost:3000`. Create a customer account at `/register`; sign in at `/login`.
4. Sign in to the admin at `/admin/login` with `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`.
5. Manage MySQL at `http://localhost:8081` using server `db`, username `catalog`, and password `catalog`.
6. API health is available at `http://localhost:18080/healthz`.

## Main API routes

- `GET /api/v1/products`: list active products.
- `GET|PUT|DELETE /api/v1/cart/:cartID`: read, save, and clear a browser cart stored in Redis.
- `POST /api/v1/auth/register` and `POST /api/v1/auth/login`: customer registration and sign-in.
- `POST /api/v1/orders` (`Idempotency-Key` UUID required), `GET /api/v1/orders?page=1&pageSize=20`, `GET /api/v1/orders/:orderID`, and `POST /api/v1/orders/:orderID/cancel`: customer checkout, paginated history, detail, and pending-order cancellation.
- `POST /api/v1/admin/auth/login`: admin-only sign-in.
- `GET /api/v1/admin/dashboard`, product/category operations, `GET /api/v1/admin/orders?page=1&pageSize=20&status=pending&q=...`, and `PATCH /api/v1/admin/orders/:orderID/status`: admin operations. Admin routes require a valid admin token.

Orders use COD/manual payment only. Checkout keys are scoped to the authenticated customer; repeated requests with the same key and payload replay the original order. Product inventory is locked in ascending ID order, checked and decremented in the same transaction as order creation. Cancelling a pending order restores stock atomically once. Admin stock adjustments are audited in `stock_adjustments`; checkout reservation and cancellation also change `products.stock`/`stock_version` but are recorded by the order rows instead, so `stock_version` is an inventory revision counter rather than an adjustment count. Admin order lists support server-side `status` and `q` filters. Redis uses AOF persistence with a Docker volume; the browser stores only a random cart ID, while cart contents stay in Redis.

## Checks

```sh
cd backend && go test -race -coverpkg=./... -coverprofile=coverage.out ./... && ./scripts/check-coverage.sh coverage.out && go vet ./...
cd ../frontend && npm test && npm run lint
```

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` before starting the API; the configured account is seeded with the administrator role and group. Customer accounts are self-registered and cannot access administrator routes.
