package service

import (
	"errors"
	"fmt"
	"github.com/example/youtube-dashboard-go-next/backend/controller/service"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"time"
)

// AuthService issues and validates signed access tokens.
type AuthService struct {
	secret []byte
	ttl    time.Duration
}

// NewAuthService creates a token service with the given secret and lifetime.
func NewAuthService(secret string, ttl time.Duration) service.AuthService {
	return &AuthService{secret: []byte(secret), ttl: ttl}
}

type authClaims struct {
	ID       int64    `json:"id"`
	Username string   `json:"username"`
	Roles    []string `json:"roles"`
	Groups   []string `json:"groups"`
	jwt.RegisteredClaims
}

// GenerateToken signs a token for the given user.
func (s *AuthService) GenerateToken(user data.User) (string, error) {
	now := time.Now()
	claims := authClaims{ID: user.ID, Username: user.Username, Roles: user.Roles, Groups: user.Groups, RegisteredClaims: jwt.RegisteredClaims{Subject: user.Username, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(s.ttl))}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
}

// ValidateToken verifies a token and stores its username in the request context.
func (s *AuthService) ValidateToken(ctx *gin.Context, raw string) error {
	token, err := jwt.ParseWithClaims(raw, &authClaims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.secret, nil
	})
	if err != nil {
		return err
	}
	claims, ok := token.Claims.(*authClaims)
	if !ok || !token.Valid || claims.Username == "" {
		return errors.New("invalid token")
	}
	ctx.Set("user_id", claims.ID)
	ctx.Set("username", claims.Username)
	ctx.Set("roles", claims.Roles)
	ctx.Set("groups", claims.Groups)
	return nil
}
