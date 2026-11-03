package controller_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/example/youtube-dashboard-go-next/backend/controller/mock"
	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
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
		case "customer", "outsider":
			id := int64(10)
			if username == "outsider" {
				id = 11
			}
			return &data.User{ID: id, Username: username, Roles: []string{"customer"}, Groups: []string{"customers"}}, nil
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
		CreateOrderFunc: func(_ context.Context, userID int64, _ string, in data.CreateOrderInput) (data.Order, bool, error) {
			return data.Order{ID: 3, UserID: userID, OrderNumber: "ORD-1", TotalVND: 2000, Status: "pending", PaymentMethod: "cod"}, false, nil
		},
		ListOrdersFunc: func(_ context.Context, userID int64, page, pageSize int) ([]data.Order, int64, error) {
			return []data.Order{{ID: 3, UserID: userID, Status: "pending", PaymentMethod: "cod"}}, 1, nil
		},
		GetOrderFunc: func(_ context.Context, userID, orderID int64) (data.Order, error) {
			if userID != 10 {
				return data.Order{}, repository.ErrOrderNotFound
			}
			return data.Order{ID: orderID, UserID: userID, Status: "pending", PaymentMethod: "cod"}, nil
		},
		CancelOrderFunc: func(_ context.Context, userID, orderID int64) (data.Order, error) {
			if userID != 10 {
				return data.Order{}, repository.ErrOrderNotFound
			}
			return data.Order{ID: orderID, UserID: userID, Status: "cancelled", PaymentMethod: "cod"}, nil
		},
		UpdateOrderStatusFunc: func(_ context.Context, orderID int64, status string) (data.Order, error) {
			return data.Order{ID: orderID, Status: status, PaymentMethod: "cod"}, nil
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
	contacts := &mock.ContactRepositoryMock{}
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	return route.SetupRouter(users, store, carts, contacts, auth, "http://localhost:3000")
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

func TestAuthLoginJSONResponseContract(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		username string
		user     map[string]any
	}{
		{
			name:     "customer login",
			endpoint: "/api/v1/auth/login",
			username: "customer",
			user: map[string]any{
				"id": float64(10), "username": "customer", "email": "",
				"roles": []any{"customer"}, "groups": []any{"customers"},
			},
		},
		{
			name:     "admin login",
			endpoint: "/api/v1/admin/auth/login",
			username: "admin",
			user: map[string]any{
				"id": float64(1), "username": "admin", "email": "",
				"roles": []any{"admin"}, "groups": []any{"administrators"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, tt.endpoint, strings.NewReader(`{"username":"`+tt.username+`","password":"correct-password"}`))
			request.Header.Set("Content-Type", "application/json")
			setupRouter().ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("login returned %d: %s", response.Code, response.Body)
			}
			var body map[string]json.RawMessage
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode login JSON: %v; body=%s", err, response.Body)
			}
			wantKeys := []string{"accessToken", "tokenType", "expiresIn", "user"}
			if len(body) != len(wantKeys) {
				t.Fatalf("unexpected top-level JSON keys (want exactly %v): %s", wantKeys, response.Body)
			}
			for _, key := range wantKeys {
				if _, ok := body[key]; !ok {
					t.Errorf("response is missing JSON key %q: %s", key, response.Body)
				}
			}

			var accessToken string
			if err := json.Unmarshal(body["accessToken"], &accessToken); err != nil || accessToken == "" {
				t.Errorf("accessToken should be a non-empty string, got %s (err=%v)", body["accessToken"], err)
			}
			var tokenType string
			if err := json.Unmarshal(body["tokenType"], &tokenType); err != nil || tokenType != "Bearer" {
				t.Errorf("tokenType should be Bearer, got %s (err=%v)", body["tokenType"], err)
			}
			var expiresIn int
			if err := json.Unmarshal(body["expiresIn"], &expiresIn); err != nil || expiresIn != 1800 {
				t.Errorf("expiresIn should be 1800, got %s (err=%v)", body["expiresIn"], err)
			}
			var user map[string]any
			if err := json.Unmarshal(body["user"], &user); err != nil {
				t.Fatalf("decode user JSON: %v; user=%s", err, body["user"])
			}
			if len(user) != len(tt.user) {
				t.Errorf("unexpected user JSON shape (want keys from fixture %v): %s", tt.user, body["user"])
			}
			for key, want := range tt.user {
				if got, ok := user[key]; !ok || !reflect.DeepEqual(got, want) {
					t.Errorf("user.%s = %#v, want %#v", key, got, want)
				}
			}
		})
	}
}

func TestRegisterJSONResponseContract(t *testing.T) {
	users := &mock.UserRepositoryMock{
		FindUserFunc: func(string, string) (*data.User, error) { return nil, errors.New("unexpected login") },
		RegisterFunc: func(_ context.Context, input data.RegisterInput) (*data.User, error) {
			return &data.User{ID: 20, Username: input.Username, Email: input.Email, Roles: []string{"customer"}, Groups: []string{"customers"}}, nil
		},
	}
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	router := route.SetupRouter(users, &mock.StoreRepositoryMock{}, &mock.CartRepositoryMock{}, &mock.ContactRepositoryMock{}, auth, "http://localhost:3000")
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"username":"new-customer","email":"new@example.com","password":"correct-password"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("register returned %d: %s", response.Code, response.Body)
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode register JSON: %v; body=%s", err, response.Body)
	}
	wantKeys := []string{"accessToken", "tokenType", "expiresIn", "user"}
	if len(body) != len(wantKeys) {
		t.Fatalf("unexpected top-level JSON keys (want exactly %v): %s", wantKeys, response.Body)
	}
	for _, key := range wantKeys {
		if _, ok := body[key]; !ok {
			t.Errorf("response is missing JSON key %q: %s", key, response.Body)
		}
	}
	var accessToken, tokenType string
	var expiresIn int
	if err := json.Unmarshal(body["accessToken"], &accessToken); err != nil || accessToken == "" {
		t.Errorf("accessToken should be a non-empty string, got %s (err=%v)", body["accessToken"], err)
	}
	if err := json.Unmarshal(body["tokenType"], &tokenType); err != nil || tokenType != "Bearer" {
		t.Errorf("tokenType should be Bearer, got %s (err=%v)", body["tokenType"], err)
	}
	if err := json.Unmarshal(body["expiresIn"], &expiresIn); err != nil || expiresIn != 1800 {
		t.Errorf("expiresIn should be 1800, got %s (err=%v)", body["expiresIn"], err)
	}
	var user map[string]any
	if err := json.Unmarshal(body["user"], &user); err != nil {
		t.Fatalf("decode user JSON: %v; user=%s", err, body["user"])
	}
	wantUser := map[string]any{
		"id": float64(20), "username": "new-customer", "email": "new@example.com",
		"roles": []any{"customer"}, "groups": []any{"customers"},
	}
	if !reflect.DeepEqual(user, wantUser) {
		t.Errorf("user = %#v, want %#v", user, wantUser)
	}
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

func TestOrderRoutesRequireIdempotencyAndPaginate(t *testing.T) {
	router := setupRouter()
	token := login(t, router, "/api/v1/auth/login", "customer")
	makeRequest := func(key, payload string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/v1/orders", strings.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+token.AccessToken)
		if key != "" {
			request.Header.Set("Idempotency-Key", key)
		}
		router.ServeHTTP(response, request)
		return response
	}
	body := `{"recipientName":"A","phone":"123","shippingAddress":"Addr","items":[{"productId":1,"quantity":1}]}`
	if response := makeRequest("", body); response.Code != http.StatusBadRequest {
		t.Fatalf("missing key status=%d body=%s", response.Code, response.Body)
	}
	if response := makeRequest("bad", body); response.Code != http.StatusBadRequest {
		t.Fatalf("bad key status=%d body=%s", response.Code, response.Body)
	}
	if response := makeRequest("9d77cd79-d774-45d0-a960-566b94069386", `{"recipientName":"A","phone":"123","shippingAddress":"Addr","items":[{"productId":1,"quantity":1},{"productId":1,"quantity":1}]}`); response.Code != http.StatusBadRequest {
		t.Fatalf("duplicate line status=%d body=%s", response.Code, response.Body)
	}
	if response := makeRequest("9d77cd79-d774-45d0-a960-566b94069386", body); response.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", response.Code, response.Body)
	}
	page := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/orders?page=2&pageSize=10", nil)
	request.Header.Set("Authorization", "Bearer "+token.AccessToken)
	router.ServeHTTP(page, request)
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), `"page":2`) || !strings.Contains(page.Body.String(), `"total":1`) {
		t.Fatalf("page status=%d body=%s", page.Code, page.Body)
	}
	bad := httptest.NewRecorder()
	badRequest := httptest.NewRequest(http.MethodGet, "/api/v1/orders?page=0", nil)
	badRequest.Header.Set("Authorization", "Bearer "+token.AccessToken)
	router.ServeHTTP(bad, badRequest)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("invalid pagination status=%d body=%s", bad.Code, bad.Body)
	}
}

func TestCheckoutReplayReturnsExistingOrder(t *testing.T) {
	var calls int
	users := &mock.UserRepositoryMock{FindUserFunc: func(username, password string) (*data.User, error) {
		if username == "customer" && password == "correct-password" {
			return &data.User{ID: 10, Username: username, Roles: []string{"customer"}, Groups: []string{"customers"}}, nil
		}
		return nil, errors.New("invalid credentials")
	}}
	store := &mock.StoreRepositoryMock{CreateOrderFunc: func(_ context.Context, userID int64, _ string, _ data.CreateOrderInput) (data.Order, bool, error) {
		calls++
		return data.Order{ID: 3, UserID: userID, OrderNumber: "ORD-1", TotalVND: 2000, Status: "pending", PaymentMethod: "cod"}, calls > 1, nil
	}}
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	router := route.SetupRouter(users, store, &mock.CartRepositoryMock{}, &mock.ContactRepositoryMock{}, auth, "http://localhost:3000")
	token := login(t, router, "/api/v1/auth/login", "customer")
	body := `{"recipientName":"A","phone":"123","shippingAddress":"Addr","items":[{"productId":1,"quantity":1}]}`
	makeRequest := func() *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/v1/orders", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+token.AccessToken)
		request.Header.Set("Idempotency-Key", "9d77cd79-d774-45d0-a960-566b94069386")
		router.ServeHTTP(response, request)
		return response
	}
	if got := makeRequest(); got.Code != http.StatusCreated {
		t.Fatalf("first checkout status=%d body=%s", got.Code, got.Body)
	}
	replay := makeRequest()
	if replay.Code != http.StatusOK || replay.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay status=%d headers=%v body=%s", replay.Code, replay.Header(), replay.Body)
	}
}

func TestOrderDetailCancelAndAdminTransitionsAreRoleProtected(t *testing.T) {
	router := setupRouter()
	customer := login(t, router, "/api/v1/auth/login", "customer")
	admin := login(t, router, "/api/v1/admin/auth/login", "admin")
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		router.ServeHTTP(response, req)
		return response
	}
	if got := request(http.MethodGet, "/api/v1/orders/3", customer.AccessToken, ""); got.Code != http.StatusOK {
		t.Fatalf("customer detail status=%d body=%s", got.Code, got.Body)
	}
	otherTokenRequest := httptest.NewRecorder()
	otherLogin := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"outsider","password":"correct-password"}`))
	otherLogin.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(otherTokenRequest, otherLogin)
	var otherToken data.TokenResponse
	if err := json.Unmarshal(otherTokenRequest.Body.Bytes(), &otherToken); err != nil {
		t.Fatal(err)
	}
	if got := request(http.MethodGet, "/api/v1/orders/3", otherToken.AccessToken, ""); got.Code != http.StatusNotFound {
		t.Fatalf("non-owner detail should be 404, got %d", got.Code)
	}
	if got := request(http.MethodPost, "/api/v1/orders/3/cancel", customer.AccessToken, ""); got.Code != http.StatusOK {
		t.Fatalf("customer cancel status=%d body=%s", got.Code, got.Body)
	}
	if got := request(http.MethodPost, "/api/v1/orders/3/cancel", otherToken.AccessToken, ""); got.Code != http.StatusNotFound {
		t.Fatalf("non-owner cancellation should be 404, got %d", got.Code)
	}
	if got := request(http.MethodPost, "/api/v1/orders/3/cancel", admin.AccessToken, ""); got.Code != http.StatusForbidden {
		t.Fatalf("admin must not use customer cancel route, got %d", got.Code)
	}
	if got := request(http.MethodGet, "/api/v1/admin/orders?page=0", admin.AccessToken, ""); got.Code != http.StatusBadRequest {
		t.Fatalf("bad admin pagination expected 400, got %d", got.Code)
	}
	if got := request(http.MethodPatch, "/api/v1/admin/orders/3/status", customer.AccessToken, `{"status":"processing"}`); got.Code != http.StatusForbidden {
		t.Fatalf("customer status update expected 403, got %d", got.Code)
	}
	if got := request(http.MethodPatch, "/api/v1/admin/orders/3/status", admin.AccessToken, `{"status":"bogus"}`); got.Code != http.StatusBadRequest {
		t.Fatalf("invalid status expected 400, got %d", got.Code)
	}
	if got := request(http.MethodPatch, "/api/v1/admin/orders/3/status", admin.AccessToken, `{"status":"pending"}`); got.Code != http.StatusBadRequest {
		t.Fatalf("pending is not a mutation target, got %d", got.Code)
	}
	if got := request(http.MethodPatch, "/api/v1/admin/orders/3/status", admin.AccessToken, `{"status":"processing"}`); got.Code != http.StatusOK {
		t.Fatalf("admin transition status=%d body=%s", got.Code, got.Body)
	}
	if got := request(http.MethodPatch, "/api/v1/admin/orders/3/status", admin.AccessToken, `{"status":"cancelled"}`); got.Code != http.StatusOK {
		t.Fatalf("admin cancellation status=%d body=%s", got.Code, got.Body)
	}
}

func TestAdminCanReadOrderDetailButCustomerCannotUseAdminEndpoint(t *testing.T) {
	var requestedID int64
	store := &mock.StoreRepositoryMock{GetAdminOrderFunc: func(_ context.Context, orderID int64) (data.Order, error) {
		requestedID = orderID
		return data.Order{ID: orderID, OrderNumber: "ORD-DETAIL", RecipientName: "Buyer", Items: []data.OrderItem{{ProductID: 9, ProductName: "Sausage", Quantity: 2, UnitPriceVND: 1000}}}, nil
	}}
	users := &mock.UserRepositoryMock{FindUserFunc: func(username, password string) (*data.User, error) {
		if password != "correct-password" {
			return nil, errors.New("invalid credentials")
		}
		role := username
		return &data.User{ID: 1, Username: username, Roles: []string{role}}, nil
	}}
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	router := route.SetupRouter(users, store, &mock.CartRepositoryMock{}, &mock.ContactRepositoryMock{}, auth, "http://localhost:3000")
	admin := login(t, router, "/api/v1/admin/auth/login", "admin")
	customer := login(t, router, "/api/v1/auth/login", "customer")
	request := func(token string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/orders/42", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		router.ServeHTTP(response, req)
		return response
	}
	response := request(admin.AccessToken)
	if response.Code != http.StatusOK || requestedID != 42 {
		t.Fatalf("admin detail status=%d requestedID=%d body=%s", response.Code, requestedID, response.Body)
	}
	var order data.Order
	if err := json.Unmarshal(response.Body.Bytes(), &order); err != nil {
		t.Fatal(err)
	}
	if order.OrderNumber != "ORD-DETAIL" || len(order.Items) != 1 || order.Items[0].ProductID != 9 {
		t.Fatalf("unexpected order detail payload: %+v", order)
	}
	if denied := request(customer.AccessToken); denied.Code != http.StatusForbidden {
		t.Fatalf("customer must not use admin detail route, got %d", denied.Code)
	}
}

func TestAdminOrderFiltersAndValidation(t *testing.T) {
	var captured data.OrderFilter
	var capturedPage, capturedPageSize int
	users := &mock.UserRepositoryMock{FindUserFunc: func(username, password string) (*data.User, error) {
		if username == "admin" && password == "correct-password" {
			return &data.User{ID: 1, Username: username, Roles: []string{"admin"}, Groups: []string{"administrators"}}, nil
		}
		return nil, errors.New("invalid credentials")
	}}
	store := &mock.StoreRepositoryMock{AdminOrdersFilteredFunc: func(_ context.Context, page, pageSize int, filter data.OrderFilter) ([]data.Order, int64, error) {
		captured, capturedPage, capturedPageSize = filter, page, pageSize
		return []data.Order{{ID: 3, Status: "pending", PaymentMethod: "cod"}}, 1, nil
	}}
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	router := route.SetupRouter(users, store, &mock.CartRepositoryMock{}, &mock.ContactRepositoryMock{}, auth, "http://localhost:3000")
	admin := login(t, router, "/api/v1/admin/auth/login", "admin")
	request := func(path string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+admin.AccessToken)
		router.ServeHTTP(response, req)
		return response
	}
	if got := request("/api/v1/admin/orders?status=Pending&q=%20gi%C3%B2%20&page=2&pageSize=15"); got.Code != http.StatusOK {
		t.Fatalf("filtered orders status=%d body=%s", got.Code, got.Body)
	}
	if captured.Status != "pending" || captured.Query != "giò" || capturedPage != 2 || capturedPageSize != 15 {
		t.Fatalf("unexpected filter: %+v page=%d pageSize=%d", captured, capturedPage, capturedPageSize)
	}
	if got := request("/api/v1/admin/orders?status=shipping"); got.Code != http.StatusBadRequest {
		t.Fatalf("invalid filter status should be 400, got %d body=%s", got.Code, got.Body)
	}
	if got := request("/api/v1/admin/orders?q=" + strings.Repeat("x", 101)); got.Code != http.StatusBadRequest {
		t.Fatalf("oversized search should be 400, got %d", got.Code)
	}
}

func TestCORSReflectsSingleConfiguredOrigin(t *testing.T) {
	router := setupRouter()
	preflight := func(origin, method string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodOptions, "/api/v1/admin/orders/3/status", nil)
		request.Header.Set("Origin", origin)
		request.Header.Set("Access-Control-Request-Method", method)
		router.ServeHTTP(response, request)
		return response
	}
	allowed := preflight("http://localhost:3000", "PATCH")
	if allowed.Code != http.StatusNoContent {
		t.Fatalf("preflight status=%d", allowed.Code)
	}
	if allowed.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Fatalf("unexpected allow origin: %q", allowed.Header().Get("Access-Control-Allow-Origin"))
	}
	if allowed.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("credentials header missing")
	}
	if !strings.Contains(allowed.Header().Get("Access-Control-Allow-Methods"), "PATCH") {
		t.Fatalf("PATCH missing from allowed methods: %q", allowed.Header().Get("Access-Control-Allow-Methods"))
	}
	if !strings.Contains(allowed.Header().Get("Access-Control-Allow-Headers"), "Idempotency-Key") {
		t.Fatalf("Idempotency-Key missing from allowed headers: %q", allowed.Header().Get("Access-Control-Allow-Headers"))
	}
	if allowed.Header().Get("Access-Control-Max-Age") != "43200" {
		t.Fatalf("max age should be seconds: %q", allowed.Header().Get("Access-Control-Max-Age"))
	}
	denied := preflight("https://evil.example", "PATCH")
	if denied.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("disallowed origin must not be reflected: %q", denied.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestCORSAllowsWildcardWithoutCredentials(t *testing.T) {
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	router := route.SetupRouter(&mock.UserRepositoryMock{}, &mock.StoreRepositoryMock{}, &mock.CartRepositoryMock{}, &mock.ContactRepositoryMock{}, auth, "*")
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/orders", nil)
	request.Header.Set("Origin", "https://any.example")
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("wildcard preflight status=%d origin=%q", response.Code, response.Header().Get("Access-Control-Allow-Origin"))
	}
	if response.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatalf("wildcard CORS must not allow credentials")
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
	router := route.SetupRouter(users, store, carts, &mock.ContactRepositoryMock{}, auth, "http://localhost:3000")
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

func TestContactRouteValidatesAndPersistsContact(t *testing.T) {
	var saved data.CreateContactInput
	contacts := &mock.ContactRepositoryMock{CreateContactFunc: func(_ context.Context, input data.CreateContactInput) (data.Contact, error) {
		saved = input
		return data.Contact{ID: 7, Name: input.Name, Phone: input.Phone, Address: input.Address, MapLocation: input.MapLocation}, nil
	}}
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	router := route.SetupRouter(&mock.UserRepositoryMock{}, &mock.StoreRepositoryMock{}, &mock.CartRepositoryMock{}, contacts, auth, "http://localhost:3000")

	invalid := httptest.NewRecorder()
	invalidRequest := httptest.NewRequest(http.MethodPost, "/api/v1/contacts", strings.NewReader(`{"name":"An"}`))
	invalidRequest.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(invalid, invalidRequest)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("incomplete contact should be rejected: %d", invalid.Code)
	}

	body := `{"name":" Nguyễn An ","phone":"0901234567","address":"12 Nguyễn Huệ, Quận 1","mapLocation":"https://maps.google.com/?q=10.7769,106.7009"}`
	created := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/contacts", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(created, request)
	if created.Code != http.StatusCreated || !strings.Contains(created.Body.String(), `"id":7`) {
		t.Fatalf("contact creation returned %d: %s", created.Code, created.Body)
	}
	if saved.Name != "Nguyễn An" || saved.Phone != "0901234567" || saved.MapLocation != "https://maps.google.com/?q=10.7769,106.7009" {
		t.Fatalf("contact was not persisted correctly: %+v", saved)
	}
}

func TestAdminContactRoutesListAndDelete(t *testing.T) {
	var deleted int64
	contacts := &mock.ContactRepositoryMock{
		ListContactsFunc: func(context.Context) ([]data.Contact, error) {
			return []data.Contact{{ID: 7, Name: "Nguyễn An", Phone: "0901234567", Address: "Quận 1", MapLocation: "https://maps.google.com/?q=10.7769,106.7009"}}, nil
		},
		DeleteContactFunc: func(_ context.Context, id int64) error {
			if id != 7 {
				return repository.ErrContactNotFound
			}
			deleted = id
			return nil
		},
	}
	users := &mock.UserRepositoryMock{FindUserFunc: func(username, password string) (*data.User, error) {
		if username == "admin" && password == "correct-password" {
			return &data.User{ID: 1, Username: username, Roles: []string{"admin"}, Groups: []string{"administrators"}}, nil
		}
		return nil, errors.New("invalid credentials")
	}}
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	router := route.SetupRouter(users, &mock.StoreRepositoryMock{}, &mock.CartRepositoryMock{}, contacts, auth, "http://localhost:3000")
	token := login(t, router, "/api/v1/admin/auth/login", "admin")

	list := httptest.NewRecorder()
	listRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/contacts", nil)
	listRequest.Header.Set("Authorization", "Bearer "+token.AccessToken)
	router.ServeHTTP(list, listRequest)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "Nguyễn An") {
		t.Fatalf("admin contact list returned %d: %s", list.Code, list.Body)
	}

	remove := httptest.NewRecorder()
	removeRequest := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/contacts/7", nil)
	removeRequest.Header.Set("Authorization", "Bearer "+token.AccessToken)
	router.ServeHTTP(remove, removeRequest)
	if remove.Code != http.StatusNoContent || deleted != 7 {
		t.Fatalf("admin contact delete returned %d (deleted=%d)", remove.Code, deleted)
	}

	missing := httptest.NewRecorder()
	missingRequest := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/contacts/99", nil)
	missingRequest.Header.Set("Authorization", "Bearer "+token.AccessToken)
	router.ServeHTTP(missing, missingRequest)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing contact should return 404, got %d", missing.Code)
	}
}
