package data

import "time"

type Product struct {
	ID               int64      `json:"id"`
	SKU              string     `json:"sku"`
	Name             string     `json:"name"`
	Description      string     `json:"description"`
	ImageURL         string     `json:"imageUrl"`
	Images           []string   `json:"images"`
	PriceVND         int64      `json:"priceVnd"`
	RegularPriceVND  int64      `json:"regularPriceVnd"`
	DiscountPriceVND *int64     `json:"discountPriceVnd"`
	DiscountStartsAt *time.Time `json:"discountStartsAt"`
	DiscountEndsAt   *time.Time `json:"discountEndsAt"`
	PriceEffectiveAt time.Time  `json:"priceEffectiveAt"`
	Stock            int        `json:"stock"`
	StockVersion     int64      `json:"stockVersion"`
	IsActive         bool       `json:"isActive"`
	Categories       []Category `json:"categories"`
}

type Category struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description string `json:"description"`
}

type CategoryInput struct {
	Name        string `json:"name" binding:"required,max=120"`
	Slug        string `json:"slug" binding:"required,max=140"`
	Description string `json:"description" binding:"max=500"`
}

// CreateProductInput is shared by product create and update. SKU is ignored on
// create (the server generates a code) and is optional on update; when omitted
// the existing code is kept. PriceVND is the legacy regular-price field so
// existing clients keep working; RegularPriceVND takes precedence when both are
// present. Stock is only applied on create; inventory changes go through the
// stock-adjustment endpoint.
type CreateProductInput struct {
	SKU              string     `json:"sku" binding:"max=64"`
	Name             string     `json:"name" binding:"required,max=255"`
	Description      string     `json:"description"`
	ImageURL         string     `json:"imageUrl"`
	ImageURLs        []string   `json:"imageUrls"`
	PriceVND         int64      `json:"priceVnd"`
	RegularPriceVND  *int64     `json:"regularPriceVnd"`
	DiscountPriceVND *int64     `json:"discountPriceVnd"`
	DiscountStartsAt *time.Time `json:"discountStartsAt"`
	DiscountEndsAt   *time.Time `json:"discountEndsAt"`
	Stock            int        `json:"stock" binding:"gte=0"`
	IsActive         *bool      `json:"isActive"`
	CategoryIDs      []int64    `json:"categoryIds"`
}

type CategoryList struct {
	Items []Category `json:"items"`
}

type ProductList struct {
	Items []Product `json:"items"`
}

type OrderLineInput struct {
	ProductID int64 `json:"productId" binding:"required,gt=0"`
	Quantity  int   `json:"quantity" binding:"required,gt=0,lte=99"`
}

type CartItem struct {
	ProductID int64 `json:"productId" binding:"required,gt=0"`
	Quantity  int   `json:"quantity" binding:"required,gt=0,lte=99"`
}

type Cart struct {
	Items []CartItem `json:"items"`
}

type CreateOrderInput struct {
	RecipientName   string           `json:"recipientName" binding:"required,max=255"`
	Phone           string           `json:"phone" binding:"required,max=32"`
	ShippingAddress string           `json:"shippingAddress" binding:"required,max=2000"`
	Items           []OrderLineInput `json:"items" binding:"required,min=1,max=100,dive"`
}

type OrderItem struct {
	ProductID    int64  `json:"productId"`
	ProductName  string `json:"productName"`
	Quantity     int    `json:"quantity"`
	UnitPriceVND int64  `json:"unitPriceVnd"`
}

type Order struct {
	ID              int64       `json:"id"`
	OrderNumber     string      `json:"orderNumber"`
	UserID          int64       `json:"userId"`
	CustomerName    string      `json:"customerName,omitempty"`
	TotalVND        int64       `json:"totalVnd"`
	Status          string      `json:"status"`
	PaymentMethod   string      `json:"paymentMethod"`
	RecipientName   string      `json:"recipientName"`
	Phone           string      `json:"phone"`
	ShippingAddress string      `json:"shippingAddress"`
	Items           []OrderItem `json:"items"`
	CreatedAt       time.Time   `json:"createdAt"`
}

// OrderPage is the paginated order list envelope shared by customer and admin APIs.
type OrderPage struct {
	Items    []Order `json:"items"`
	Page     int     `json:"page"`
	PageSize int     `json:"pageSize"`
	Total    int64   `json:"total"`
}

type DashboardStats struct {
	ProductCount  int64 `json:"productCount"`
	OrderCount    int64 `json:"orderCount"`
	PendingOrders int64 `json:"pendingOrders"`
	RevenueVND    int64 `json:"revenueVnd"`
}

// StockAdjustmentInput is the admin stock mutation body. Delta is signed and
// must not be zero; reason is required for the immutable audit trail.
//
// The stock_adjustments audit trail intentionally covers admin adjustments only.
// Checkout reservations and order cancellations also change products.stock and
// increment products.stock_version, but they are recorded by the orders and
// order_items rows and are not duplicated into stock_adjustments.
type StockAdjustmentInput struct {
	Delta          int64  `json:"delta" binding:"required"`
	Reason         string `json:"reason" binding:"required,max=255"`
	IdempotencyKey string `json:"idempotencyKey" binding:"max=64"`
}

// StockAdjustmentResult is returned by the stock-adjustment endpoint. Stock and
// StockVersion are the product's current inventory state at response time. For
// an idempotent replay they are re-read rather than copied from the original
// adjustment, so a stale stock_after value is never presented as current.
type StockAdjustmentResult struct {
	ProductID    int64 `json:"productId"`
	Stock        int   `json:"stock"`
	StockVersion int64 `json:"stockVersion"`
	Replayed     bool  `json:"replayed"`
}

// DeliverySettings is the singleton, informational store delivery record.
type DeliverySettings struct {
	Phone        string    `json:"phone"`
	Address      string    `json:"address"`
	MapLocation  string    `json:"mapLocation"`
	DeliveryText string    `json:"deliveryText"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Version      int64     `json:"version"`
}

// UpdateDeliverySettingsInput is a full replacement of the editable delivery
// fields. ExpectedVersion guards against stale admin writes.
type UpdateDeliverySettingsInput struct {
	Phone           string `json:"phone" binding:"max=32"`
	Address         string `json:"address" binding:"max=2000"`
	MapLocation     string `json:"mapLocation" binding:"max=2000"`
	DeliveryText    string `json:"deliveryText" binding:"max=5000"`
	ExpectedVersion *int64 `json:"expectedVersion"`
}

// EffectiveProductPriceVND returns the customer-facing unit price at now. A
// discount is active over the half-open interval [startsAt, endsAt).
func EffectiveProductPriceVND(regular int64, discount *int64, startsAt, endsAt *time.Time, now time.Time) int64 {
	if discount == nil || startsAt == nil || endsAt == nil {
		return regular
	}
	if !now.Before(*startsAt) && now.Before(*endsAt) {
		return *discount
	}
	return regular
}
