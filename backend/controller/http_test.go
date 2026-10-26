package controller_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/youtube-dashboard-go-next/backend/controller/mock"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/example/youtube-dashboard-go-next/backend/route"
	"github.com/example/youtube-dashboard-go-next/backend/service"
	"github.com/gin-gonic/gin"
)

func setupRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	users := &mock.UserRepositoryMock{FindUserFunc: func(username, password string) (*data.User, error) {
		if password != "correct-password" {
			return nil, errors.New("invalid credentials")
		}
		switch username {
		case "customer":
			return &data.User{ID: 10, Username: username, Roles: []string{"customer"}, Groups: []string{"customers"}}, nil
		case "admin":
			return &data.User{ID: 1, Username: username, Roles: []string{"admin"}, Groups: []string{"administrators"}}, nil
		default:
			return nil, errors.New("invalid credentials")
		}
	}}
	store := &mock.StoreRepositoryMock{
		ListCategoriesFunc: func(context.Context) ([]data.Category, error) {
			return []data.Category{{ID: 1, Name: "Giò chả", Slug: "gio-cha"}}, nil
		},
		ListProductsFunc: func(_ context.Context, includeInactive bool) ([]data.Product, error) {
			return []data.Product{{ID: 1, SKU: "SKU-1", Name: "Test item", PriceVND: 1000, Stock: 5, IsActive: true}}, nil
		},
		GetProductFunc: func(_ context.Context, productID int64) (data.Product, error) {
			if productID != 1 {
				return data.Product{}, errors.New("product not found")
			}
			return data.Product{ID: 1, SKU: "SKU-1", Name: "Test item", PriceVND: 1000, Stock: 5, IsActive: true}, nil
		},
		CreateProductFunc: func(_ context.Context, in data.CreateProductInput) (data.Product, error) {
			return data.Product{ID: 2, SKU: in.SKU, Name: in.Name, PriceVND: in.PriceVND, Stock: in.Stock, IsActive: true}, nil
		},
		CreateOrderFunc: func(_ context.Context, userID int64, in data.CreateOrderInput) (data.Order, error) {
			return data.Order{ID: 3, UserID: userID, OrderNumber: "ORD-1", TotalVND: 2000, Status: "pending"}, nil
		},
		ListOrdersFunc: func(_ context.Context, userID int64) ([]data.Order, error) {
			return []data.Order{{ID: 3, UserID: userID}}, nil
		},
		DashboardStatsFunc: func(context.Context) (data.DashboardStats, error) {
			return data.DashboardStats{ProductCount: 4, OrderCount: 8, PendingOrders: 2, RevenueVND: 42000}, nil
		},
	}
	carts := &mock.CartRepositoryMock{
		GetCartFunc:   func(context.Context, string) ([]data.CartItem, error) { return []data.CartItem{}, nil },
		SaveCartFunc:  func(context.Context, string, []data.CartItem) error { return nil },
		ClearCartFunc: func(context.Context, string) error { return nil },
	}
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	return route.SetupRouter(users, store, carts, auth, "http://localhost:3000")
}

func login(t *testing.T, router http.Handler, endpoint, username string) data.TokenResponse {
	t.Helper()
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(`{"username":"`+username+`","password":"correct-password"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("login %s returned %d: %s", endpoint, response.Code, response.Body)
	}
	var token data.TokenResponse
	if err := json.Unmarshal(response.Body.Bytes(), &token); err != nil || token.AccessToken == "" {
		t.Fatalf("missing access token: %v", err)
	}
	return token
}

func TestStoreProductsAndRoleRestrictedRoutes(t *testing.T) {
	router := setupRouter()
	products := httptest.NewRecorder()
	router.ServeHTTP(products, httptest.NewRequest(http.MethodGet, "/api/v1/products", nil))
	if products.Code != http.StatusOK || !strings.Contains(products.Body.String(), "Test item") {
		t.Fatalf("public product listing returned %d: %s", products.Code, products.Body)
	}
	detail := httptest.NewRecorder()
	router.ServeHTTP(detail, httptest.NewRequest(http.MethodGet, "/api/v1/products/1", nil))
	if detail.Code != http.StatusOK || !strings.Contains(detail.Body.String(), "Test item") {
		t.Fatalf("public product detail returned %d: %s", detail.Code, detail.Body)
	}

	customerToken := login(t, router, "/api/v1/auth/login", "customer")
	customerResponse := httptest.NewRecorder()
	customerRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/dashboard", nil)
	customerRequest.Header.Set("Authorization", "Bearer "+customerToken.AccessToken)
	router.ServeHTTP(customerResponse, customerRequest)
	if customerResponse.Code != http.StatusForbidden {
		t.Fatalf("customer should not access admin dashboard: %d", customerResponse.Code)
	}

	adminToken := login(t, router, "/api/v1/admin/auth/login", "admin")
	adminResponse := httptest.NewRecorder()
	adminRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/dashboard", nil)
	adminRequest.Header.Set("Authorization", "Bearer "+adminToken.AccessToken)
	router.ServeHTTP(adminResponse, adminRequest)
	if adminResponse.Code != http.StatusOK || !strings.Contains(adminResponse.Body.String(), "productCount") {
		t.Fatalf("admin dashboard returned %d: %s", adminResponse.Code, adminResponse.Body)
	}

	wrongPortal := httptest.NewRecorder()
	wrongRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/auth/login", strings.NewReader(`{"username":"customer","password":"correct-password"}`))
	wrongRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(wrongPortal, wrongRequest)
	if wrongPortal.Code != http.StatusForbidden {
		t.Fatalf("customer must not sign in through admin login: %d", wrongPortal.Code)
	}
}

func TestProtectedStoreRouteRejectsMissingToken(t *testing.T) {
	response := httptest.NewRecorder()
	setupRouter().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/orders", strings.NewReader(`{}`)))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
}

func TestCartRoutesValidateAndPersistCartItems(t *testing.T) {
	var saved []data.CartItem
	carts := &mock.CartRepositoryMock{
		GetCartFunc: func(context.Context, string) ([]data.CartItem, error) { return saved, nil },
		SaveCartFunc: func(_ context.Context, _ string, items []data.CartItem) error {
			saved = items
			return nil
		},
		ClearCartFunc: func(context.Context, string) error {
			saved = []data.CartItem{}
			return nil
		},
	}
	users := &mock.UserRepositoryMock{}
	store := &mock.StoreRepositoryMock{}
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	router := route.SetupRouter(users, store, carts, auth, "http://localhost:3000")
	cartID := "9d77cd79-d774-45d0-a960-566b94069386"
	put := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/v1/cart/"+cartID, strings.NewReader(`{"items":[{"productId":3,"quantity":2}]}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(put, request)
	if put.Code != http.StatusOK || len(saved) != 1 || saved[0].ProductID != 3 || saved[0].Quantity != 2 {
		t.Fatalf("cart save returned %d: %s", put.Code, put.Body)
	}

	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/api/v1/cart/"+cartID, nil))
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), `"quantity":2`) {
		t.Fatalf("cart get returned %d: %s", get.Code, get.Body)
	}

	invalid := httptest.NewRecorder()
	router.ServeHTTP(invalid, httptest.NewRequest(http.MethodGet, "/api/v1/cart/not-a-uuid", nil))
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid cart ID should be rejected: %d", invalid.Code)
	}
}
