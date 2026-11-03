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
	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/example/youtube-dashboard-go-next/backend/route"
	"github.com/example/youtube-dashboard-go-next/backend/service"
	"github.com/gin-gonic/gin"
)

func newFollowupRouter(store *mock.StoreRepositoryMock) *gin.Engine {
	gin.SetMode(gin.TestMode)
	users := &mock.UserRepositoryMock{FindUserFunc: func(username, password string) (*data.User, error) {
		if password != "correct-password" {
			return nil, errors.New("invalid credentials")
		}
		switch username {
		case "admin":
			return &data.User{ID: 1, Username: username, Roles: []string{"admin"}, Groups: []string{"administrators"}}, nil
		case "customer":
			return &data.User{ID: 10, Username: username, Roles: []string{"customer"}, Groups: []string{"customers"}}, nil
		default:
			return nil, errors.New("invalid credentials")
		}
	}}
	auth := service.NewAuthService("0123456789abcdef0123456789abcdef", time.Hour)
	return route.SetupRouter(users, store, &mock.CartRepositoryMock{}, &mock.ContactRepositoryMock{}, auth, "http://localhost:3000")
}

func followupRequest(router http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	router.ServeHTTP(response, request)
	return response
}

func TestAdminStockAdjustmentEndpoint(t *testing.T) {
	var capturedProductID, capturedActorID int64
	var captured data.StockAdjustmentInput
	store := &mock.StoreRepositoryMock{AdjustProductStockFunc: func(_ context.Context, productID, actorUserID int64, input data.StockAdjustmentInput) (data.StockAdjustmentResult, error) {
		capturedProductID, capturedActorID, captured = productID, actorUserID, input
		return data.StockAdjustmentResult{ProductID: productID, Stock: 18, StockVersion: 4}, nil
	}}
	router := newFollowupRouter(store)
	admin := login(t, router, "/api/v1/admin/auth/login", "admin")
	customer := login(t, router, "/api/v1/auth/login", "customer")

	if got := followupRequest(router, http.MethodPost, "/api/v1/admin/products/7/stock-adjustments", customer.AccessToken, `{"delta":-2,"reason":"damaged"}`); got.Code != http.StatusForbidden {
		t.Fatalf("customer stock adjustment = %d, want 403", got.Code)
	}
	for _, body := range []string{
		`{"delta":0,"reason":"damaged"}`,
		`{"delta":-2}`,
		`{"delta":-2,"reason":"damaged","idempotencyKey":"not-a-uuid"}`,
	} {
		if got := followupRequest(router, http.MethodPost, "/api/v1/admin/products/7/stock-adjustments", admin.AccessToken, body); got.Code != http.StatusBadRequest {
			t.Fatalf("invalid stock adjustment %s = %d, want 400", body, got.Code)
		}
	}

	got := followupRequest(router, http.MethodPost, "/api/v1/admin/products/7/stock-adjustments", admin.AccessToken,
		`{"delta":-2,"reason":"damaged","idempotencyKey":"9D77CD79-D774-45D0-A960-566B94069386"}`)
	if got.Code != http.StatusOK {
		t.Fatalf("stock adjustment = %d: %s", got.Code, got.Body)
	}
	if capturedProductID != 7 || capturedActorID != 1 || captured.Delta != -2 || captured.Reason != "damaged" {
		t.Fatalf("unexpected captured stock adjustment: product=%d actor=%d input=%+v", capturedProductID, capturedActorID, captured)
	}
	if captured.IdempotencyKey != "9d77cd79-d774-45d0-a960-566b94069386" {
		t.Fatalf("idempotency key was not normalized: %q", captured.IdempotencyKey)
	}
	var result data.StockAdjustmentResult
	if err := json.Unmarshal(got.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.ProductID != 7 || result.Stock != 18 || result.StockVersion != 4 || result.Replayed {
		t.Fatalf("unexpected stock result: %+v", result)
	}
}

func TestAdminStockAdjustmentReplayReportsCurrentStock(t *testing.T) {
	// The model re-reads current stock on replay; the controller must not drop
	// the replay marker or rewrite the live values.
	store := &mock.StoreRepositoryMock{AdjustProductStockFunc: func(_ context.Context, productID, actorUserID int64, input data.StockAdjustmentInput) (data.StockAdjustmentResult, error) {
		if productID != 7 || actorUserID != 1 || input.Delta != -2 || input.Reason != "damaged" {
			t.Fatalf("unexpected replay request: product=%d actor=%d input=%+v", productID, actorUserID, input)
		}
		return data.StockAdjustmentResult{ProductID: 7, Stock: 11, StockVersion: 6, Replayed: true}, nil
	}}
	router := newFollowupRouter(store)
	admin := login(t, router, "/api/v1/admin/auth/login", "admin")

	got := followupRequest(router, http.MethodPost, "/api/v1/admin/products/7/stock-adjustments", admin.AccessToken,
		`{"delta":-2,"reason":"damaged","idempotencyKey":"9d77cd79-d774-45d0-a960-566b94069386"}`)
	if got.Code != http.StatusOK {
		t.Fatalf("replayed stock adjustment = %d: %s", got.Code, got.Body)
	}
	var result data.StockAdjustmentResult
	if err := json.Unmarshal(got.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Replayed || result.Stock != 11 || result.StockVersion != 6 {
		t.Fatalf("replay must expose current stock/version and replay marker, got %+v", result)
	}
}

func TestAdminStockAdjustmentConflictMapping(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{name: "negative stock", err: repository.ErrInsufficientStock, want: http.StatusConflict},
		{name: "overflow", err: repository.ErrStockOverflow, want: http.StatusConflict},
		{name: "idempotency conflict", err: repository.ErrStockIdempotencyConflict, want: http.StatusConflict},
		{name: "missing product", err: repository.ErrProductNotFound, want: http.StatusNotFound},
		{name: "generic failure", err: errors.New("database unavailable"), want: http.StatusInternalServerError},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			store := &mock.StoreRepositoryMock{AdjustProductStockFunc: func(context.Context, int64, int64, data.StockAdjustmentInput) (data.StockAdjustmentResult, error) {
				return data.StockAdjustmentResult{}, tt.err
			}}
			router := newFollowupRouter(store)
			admin := login(t, router, "/api/v1/admin/auth/login", "admin")
			got := followupRequest(router, http.MethodPost, "/api/v1/admin/products/7/stock-adjustments", admin.AccessToken, `{"delta":-2,"reason":"damaged"}`)
			if got.Code != tt.want {
				t.Fatalf("status = %d, want %d body=%s", got.Code, tt.want, got.Body)
			}
		})
	}
}

func TestDeliverySettingsEndpoints(t *testing.T) {
	base := data.DeliverySettings{
		Phone:        "0901234567",
		Address:      "12 Nguyễn Huệ, Quận 1",
		MapLocation:  "https://maps.google.com/?q=10.7769,106.7009",
		DeliveryText: "Giao hàng trong ngày.",
		UpdatedAt:    time.Date(2026, 11, 3, 10, 30, 0, 0, time.UTC),
		Version:      3,
	}
	var captured data.UpdateDeliverySettingsInput
	store := &mock.StoreRepositoryMock{
		GetDeliverySettingsFunc: func(context.Context) (data.DeliverySettings, error) { return base, nil },
		UpdateDeliverySettingsFunc: func(_ context.Context, input data.UpdateDeliverySettingsInput) (data.DeliverySettings, error) {
			captured = input
			if input.ExpectedVersion == nil || *input.ExpectedVersion != base.Version {
				return data.DeliverySettings{}, repository.ErrDeliveryVersionConflict
			}
			return data.DeliverySettings{Phone: input.Phone, Address: input.Address, MapLocation: input.MapLocation, DeliveryText: input.DeliveryText, UpdatedAt: base.UpdatedAt.Add(time.Minute), Version: base.Version + 1}, nil
		},
	}
	router := newFollowupRouter(store)
	admin := login(t, router, "/api/v1/admin/auth/login", "admin")
	customer := login(t, router, "/api/v1/auth/login", "customer")

	for _, method := range []string{http.MethodGet, http.MethodPut} {
		body := ""
		if method == http.MethodPut {
			body = `{"phone":"0901234567","expectedVersion":3}`
		}
		if got := followupRequest(router, method, "/api/v1/admin/settings/delivery", customer.AccessToken, body); got.Code != http.StatusForbidden {
			t.Fatalf("customer %s delivery settings = %d, want 403", method, got.Code)
		}
	}

	if got := followupRequest(router, http.MethodGet, "/api/v1/admin/settings/delivery", admin.AccessToken, ""); got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"version":3`) {
		t.Fatalf("admin delivery GET = %d: %s", got.Code, got.Body)
	}
	if got := followupRequest(router, http.MethodPut, "/api/v1/admin/settings/delivery", admin.AccessToken, `{"phone":"0901234567"}`); got.Code != http.StatusBadRequest {
		t.Fatalf("missing expectedVersion = %d, want 400: %s", got.Code, got.Body)
	}
	if got := followupRequest(router, http.MethodPut, "/api/v1/admin/settings/delivery", admin.AccessToken, `{"phone":"0901234567","expectedVersion":2}`); got.Code != http.StatusConflict || !strings.Contains(got.Body.String(), `"code":"VERSION_CONFLICT"`) {
		t.Fatalf("stale delivery version = %d, want 409 VERSION_CONFLICT: %s", got.Code, got.Body)
	}
	got := followupRequest(router, http.MethodPut, "/api/v1/admin/settings/delivery", admin.AccessToken,
		`{"phone":"0901234567","address":"1 Lê Lợi","mapLocation":"https://maps.example","deliveryText":"Giao trong ngày.","expectedVersion":3}`)
	if got.Code != http.StatusOK {
		t.Fatalf("delivery update = %d: %s", got.Code, got.Body)
	}
	if captured.ExpectedVersion == nil || *captured.ExpectedVersion != 3 || captured.Address != "1 Lê Lợi" {
		t.Fatalf("unexpected captured delivery update: %+v", captured)
	}
	if !strings.Contains(got.Body.String(), `"version":4`) {
		t.Fatalf("updated delivery response missing version 4: %s", got.Body)
	}
}

func TestAdminProductWriteContractAndErrorMapping(t *testing.T) {
	var created data.CreateProductInput
	var updated data.CreateProductInput
	createErr := error(nil)
	updateErr := error(nil)
	store := &mock.StoreRepositoryMock{
		CreateProductFunc: func(_ context.Context, input data.CreateProductInput) (data.Product, error) {
			created = input
			if createErr != nil {
				return data.Product{}, createErr
			}
			return data.Product{ID: 2, SKU: "TKAB12CD34EF", Name: input.Name, RegularPriceVND: 50000, PriceVND: 50000, IsActive: true}, nil
		},
		UpdateProductFunc: func(_ context.Context, id int64, input data.CreateProductInput) (data.Product, error) {
			updated = input
			if updateErr != nil {
				return data.Product{}, updateErr
			}
			return data.Product{ID: id, SKU: "TKAB12CD34EF", Name: input.Name, RegularPriceVND: 50000, PriceVND: 50000, IsActive: true}, nil
		},
	}
	router := newFollowupRouter(store)
	admin := login(t, router, "/api/v1/admin/auth/login", "admin")

	got := followupRequest(router, http.MethodPost, "/api/v1/admin/products", admin.AccessToken, `{"name":"Bánh mì","regularPriceVnd":50000,"stock":2}`)
	if got.Code != http.StatusCreated {
		t.Fatalf("product create without client SKU = %d: %s", got.Code, got.Body)
	}
	if created.SKU != "" {
		t.Fatalf("create input must not carry a client SKU through to the model: %q", created.SKU)
	}
	if !strings.Contains(got.Body.String(), `"sku":"TKAB12CD34EF"`) {
		t.Fatalf("create response must include the generated SKU: %s", got.Body)
	}

	got = followupRequest(router, http.MethodPut, "/api/v1/admin/products/5", admin.AccessToken, `{"name":"Bánh mì","priceVnd":50000}`)
	if got.Code != http.StatusOK {
		t.Fatalf("product update = %d: %s", got.Code, got.Body)
	}
	if updated.Stock != 0 || updated.SKU != "" {
		t.Fatalf("update must leave stock/SKU handling to the model: %+v", updated)
	}

	cases := []struct {
		name      string
		method    string
		path      string
		body      string
		createErr error
		updateErr error
		want      int
	}{
		{name: "invalid discount", method: http.MethodPost, path: "/api/v1/admin/products", body: `{"name":"X","regularPriceVnd":1000}`, createErr: repository.ErrInvalidDiscountSchedule, want: http.StatusUnprocessableEntity},
		{name: "sku conflict", method: http.MethodPost, path: "/api/v1/admin/products", body: `{"name":"X","regularPriceVnd":1000}`, createErr: repository.ErrSKUConflict, want: http.StatusConflict},
		{name: "invalid product", method: http.MethodPost, path: "/api/v1/admin/products", body: `{"name":"X","regularPriceVnd":1000}`, createErr: repository.ErrInvalidProductInput, want: http.StatusBadRequest},
		{name: "storage failure", method: http.MethodPost, path: "/api/v1/admin/products", body: `{"name":"X","regularPriceVnd":1000}`, createErr: errors.New("database unavailable"), want: http.StatusInternalServerError},
		{name: "missing product", method: http.MethodPut, path: "/api/v1/admin/products/5", body: `{"name":"X","regularPriceVnd":1000}`, updateErr: repository.ErrProductNotFound, want: http.StatusNotFound},
		{name: "invalid update", method: http.MethodPut, path: "/api/v1/admin/products/5", body: `{"name":"X","regularPriceVnd":1000}`, updateErr: repository.ErrInvalidProductInput, want: http.StatusBadRequest},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			createErr, updateErr = tt.createErr, tt.updateErr
			got := followupRequest(router, tt.method, tt.path, admin.AccessToken, tt.body)
			if got.Code != tt.want {
				t.Fatalf("status = %d, want %d body=%s", got.Code, tt.want, got.Body)
			}
			if tt.name == "sku conflict" && !strings.Contains(got.Body.String(), `"code":"SKU_CONFLICT"`) {
				t.Fatalf("SKU conflict response missing stable code: %s", got.Body)
			}
		})
	}
}
