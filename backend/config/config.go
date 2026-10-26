package config

import "os"

// Config contains the application settings loaded at startup.
type Config struct {
	Port          string
	DatabaseURL   string
	RedisURL      string
	JWTSecret     string
	AdminUsername string
	AdminPassword string
	CORSOrigin    string
}

// Load reads application settings from environment variables.
func Load() Config {
	return Config{Port: env("PORT", "8080"), DatabaseURL: env("DATABASE_URL", "catalog:catalog@tcp(localhost:3306)/catalog?parseTime=true"), RedisURL: env("REDIS_URL", "redis://localhost:6379/0"), JWTSecret: os.Getenv("JWT_SECRET"), AdminUsername: env("ADMIN_USERNAME", "admin"), AdminPassword: os.Getenv("ADMIN_PASSWORD"), CORSOrigin: env("CORS_ORIGIN", "http://localhost:3000")}
}
func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
