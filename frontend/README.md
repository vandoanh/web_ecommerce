# Storefront web app

Customer pages are `/`, `/login`, and `/register`. The admin portal is `/admin/login` and `/admin`.

Set `NEXT_PUBLIC_API_URL` to the API origin when it is not `http://localhost:8080`. Customer and admin access tokens use separate browser storage keys, and the API enforces their roles on protected routes.
