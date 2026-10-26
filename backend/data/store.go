package data

import "time"

type Product struct {
	ID          int64      `json:"id"`
	SKU         string     `json:"sku"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	ImageURL    string     `json:"imageUrl"`
	Images      []string   `json:"images"`
	PriceVND    int64      `json:"priceVnd"`
	Stock       int        `json:"stock"`
	IsActive    bool       `json:"isActive"`
	Categories  []Category `json:"categories"`
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

type CreateProductInput struct {
	SKU         string  `json:"sku" binding:"required,max=64"`
	Name        string  `json:"name" binding:"required,max=255"`
	Description string  `json:"description"`
	ImageURL    string  `json:"imageUrl"`
	ImageURLs   []string `json:"imageUrls"`
	PriceVND    int64   `json:"priceVnd" binding:"required,gt=0"`
	Stock       int     `json:"stock" binding:"gte=0"`
	CategoryIDs []int64 `json:"categoryIds"`
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
	Items           []OrderLineInput `json:"items" binding:"required,min=1,dive"`
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
	RecipientName   string      `json:"recipientName"`
	Phone           string      `json:"phone"`
	ShippingAddress string      `json:"shippingAddress"`
	Items           []OrderItem `json:"items"`
	CreatedAt       time.Time   `json:"createdAt"`
}

type DashboardStats struct {
	ProductCount  int64 `json:"productCount"`
	OrderCount    int64 `json:"orderCount"`
	PendingOrders int64 `json:"pendingOrders"`
	RevenueVND    int64 `json:"revenueVnd"`
}
