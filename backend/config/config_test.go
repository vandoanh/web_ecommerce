package config

import "testing"

func TestLoadUsesDefaults(t *testing.T) {
	t.Setenv("PORT", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("ADMIN_USERNAME", "")
	t.Setenv("ADMIN_PASSWORD", "")
	t.Setenv("CORS_ORIGIN", "")

	got := Load()
	if got.Port != "8080" || got.DatabaseURL != "catalog:catalog@tcp(localhost:3306)/catalog?parseTime=true" {
		t.Fatalf("unexpected defaults: %+v", got)
	}
	if got.RedisURL != "redis://localhost:6379/0" {
		t.Fatalf("unexpected Redis URL default: %q", got.RedisURL)
	}
	if got.AdminUsername != "admin" || got.AdminPassword != "" || got.CORSOrigin != "http://localhost:3000" {
		t.Fatalf("unexpected application defaults: %+v", got)
	}
	if got.JWTSecret != "" {
		t.Fatalf("expected empty JWT secret by default, got %q", got.JWTSecret)
	}
}

func TestLoadReadsEnvironment(t *testing.T) {
	values := map[string]string{
		"PORT": "9090", "DATABASE_URL": "db-url", "REDIS_URL": "redis://cache:6379/0", "JWT_SECRET": "jwt-secret",
		"ADMIN_USERNAME": "operator", "ADMIN_PASSWORD": "password", "CORS_ORIGIN": "https://app.example",
	}
	for key, value := range values {
		t.Setenv(key, value)
	}

	got := Load()
	if got.Port != values["PORT"] || got.DatabaseURL != values["DATABASE_URL"] || got.RedisURL != values["REDIS_URL"] || got.JWTSecret != values["JWT_SECRET"] ||
		got.AdminUsername != values["ADMIN_USERNAME"] || got.AdminPassword != values["ADMIN_PASSWORD"] || got.CORSOrigin != values["CORS_ORIGIN"] {
		t.Fatalf("environment values were not loaded: %+v", got)
	}
}
