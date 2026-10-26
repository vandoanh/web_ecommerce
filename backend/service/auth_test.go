package service

import (
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAuthServiceIssuesAndValidatesJWT(t *testing.T) {
	gin.SetMode(gin.TestMode)
	auth := NewAuthService("0123456789abcdef0123456789abcdef", time.Minute)
	token, err := auth.GenerateToken(data.User{Username: "demo"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	if err = auth.ValidateToken(ctx, token); err != nil {
		t.Fatal(err)
	}
	if username, _ := ctx.Get("username"); username != "demo" {
		t.Fatalf("expected username claim, got %v", username)
	}
}
func TestAuthServiceRejectsTamperedJWT(t *testing.T) {
	gin.SetMode(gin.TestMode)
	auth := NewAuthService("0123456789abcdef0123456789abcdef", time.Minute)
	token, err := auth.GenerateToken(data.User{Username: "demo"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	if err = auth.ValidateToken(ctx, token+"x"); err == nil {
		t.Fatal("expected tampered JWT to be rejected")
	}
}
