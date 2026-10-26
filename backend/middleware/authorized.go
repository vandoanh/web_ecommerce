package middleware

import (
	"net/http"
	"strings"

	authservice "github.com/example/youtube-dashboard-go-next/backend/controller/service"
	"github.com/gin-gonic/gin"
)

type Authorized struct{ authService authservice.AuthService }

func NewAuthorized(auth authservice.AuthService) *Authorized { return &Authorized{authService: auth} }

func (m *Authorized) TokenAuthMiddleware() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		parts := strings.SplitN(ctx.GetHeader("Authorization"), " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
			ctx.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "bearer token required"})
			return
		}
		if err := m.authService.ValidateToken(ctx, strings.TrimSpace(parts[1])); err != nil {
			ctx.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}
		ctx.Next()
	}
}

func RequireRole(role string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		roles, _ := ctx.Get("roles")
		for _, value := range rolesAsStrings(roles) {
			if value == role {
				ctx.Next()
				return
			}
		}
		ctx.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
	}
}

func rolesAsStrings(value any) []string {
	roles, _ := value.([]string)
	return roles
}
