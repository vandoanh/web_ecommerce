# Backend layers

The packages follow the layering used in `mvc_golang`:

- `controller`: Gin HTTP controllers.
- `controller/repository` and `controller/service`: dependency interfaces consumed by controllers and services.
- `controller/mock`: small function-backed mocks used by unit and HTTP tests.
- `data`: JSON request/response DTOs shared across layers.
- `model`: MySQL persistence for users, products, inventory and orders.
- `service`: application logic and JWT implementation.
- `middleware`: bearer-token authorization.
- `route`: route registration and dependency injection.
- `config`: environment configuration and MySQL connection.

Customer and administrator accounts use separate roles and group memberships. Admin API routes require the `admin` role; customer routes require `customer`. Product stock is checked and decremented in the order transaction.

Dependency flow is `route → controller → service/repository interfaces`, with concrete implementations wired in `main.go`.
