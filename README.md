# Tuấn Khang — cửa hàng giò chả & pa-tê (Go + Next.js)

A starter online shop with a product storefront, customer accounts, shopping cart, checkout, inventory tracking, and a role-protected admin area.

## Stack

- API: Go, Gin, MySQL, Redis, JSON REST, bcrypt password hashes, HS256 JWT.
- Web: Next.js App Router, React, TypeScript, Tailwind CSS.
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
- `POST /api/v1/orders` and `GET /api/v1/orders`: customer checkout and order history.
- `POST /api/v1/admin/auth/login`: admin-only sign-in.
- `GET /api/v1/admin/dashboard`, `GET|POST /api/v1/admin/products`, `GET /api/v1/admin/orders`: admin operations. Admin routes require a valid admin token.

Orders lock product inventory while checking stock, compute totals from database prices, and decrement inventory in the same transaction as order creation. Redis uses AOF persistence with a Docker volume; the browser stores only a random cart ID, while cart contents stay in Redis.

## Checks

```sh
cd backend && go test -race -coverpkg=./... -coverprofile=coverage.out ./... && ./scripts/check-coverage.sh coverage.out && go vet ./...
cd ../frontend && npm test && npm run lint
```

Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` before starting the API; the configured account is seeded with the administrator role and group. Customer accounts are self-registered and cannot access administrator routes.
