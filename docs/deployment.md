# CI and release

CI runs Go tests, vet/build, frontend unit tests, lint and production build on pushes and pull requests. Release workflow publishes separate API and web images to GHCR when a `vX.Y.Z` tag is pushed. Enable GitHub Actions and package access for the repository before releasing.

For deployment, set a unique strong `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DATABASE_URL`, and `CORS_ORIGIN` in the target environment. Customer registration is public and assigns only the customer role. The configured admin account is seeded with the administrator role and group. Review the browser token storage approach and switch to secure HttpOnly cookies before exposing the service to production traffic.
