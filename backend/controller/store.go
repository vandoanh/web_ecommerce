package controller

import (
	"errors"
	"math"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/gin-gonic/gin"
)

type StoreController struct {
	store     repository.StoreRepository
	UploadDir string
}

func NewStoreController(store repository.StoreRepository) *StoreController {
	uploadDir := os.Getenv("UPLOAD_DIR")
	if uploadDir == "" {
		uploadDir = "./uploads"
	}
	return &StoreController{store: store, UploadDir: uploadDir}
}

func (c *StoreController) ListCategories(ctx *gin.Context) {
	categories, err := c.store.ListCategories(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load categories"})
		return
	}
	ctx.JSON(http.StatusOK, data.CategoryList{Items: categories})
}

func (c *StoreController) CreateCategory(ctx *gin.Context) {
	var input data.CategoryInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid category name and slug are required"})
		return
	}
	category, err := c.store.CreateCategory(ctx.Request.Context(), input)
	if err != nil {
		ctx.JSON(http.StatusConflict, gin.H{"error": "category name or slug already exists"})
		return
	}
	ctx.JSON(http.StatusCreated, category)
}

func (c *StoreController) UpdateCategory(ctx *gin.Context) {
	id, ok := parsePositiveID(ctx, "categoryID")
	if !ok {
		return
	}
	var input data.CategoryInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid category name and slug are required"})
		return
	}
	category, err := c.store.UpdateCategory(ctx.Request.Context(), id, input)
	if errors.Is(err, repository.ErrCategoryNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	}
	if err != nil {
		ctx.JSON(http.StatusConflict, gin.H{"error": "category name or slug already exists"})
		return
	}
	ctx.JSON(http.StatusOK, category)
}

func (c *StoreController) DeleteCategory(ctx *gin.Context) {
	id, ok := parsePositiveID(ctx, "categoryID")
	if !ok {
		return
	}
	if err := c.store.DeleteCategory(ctx.Request.Context(), id); errors.Is(err, repository.ErrCategoryNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	} else if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete category"})
		return
	}
	ctx.Status(http.StatusNoContent)
}

func parsePositiveID(ctx *gin.Context, param string) (int64, bool) {
	id, err := strconv.ParseInt(ctx.Param(param), 10, 64)
	if err != nil || id < 1 {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid ID is required"})
		return 0, false
	}
	return id, true
}

func (c *StoreController) ListProducts(ctx *gin.Context) {
	products, err := c.store.ListProducts(ctx.Request.Context(), false)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load products"})
		return
	}
	ctx.JSON(http.StatusOK, data.ProductList{Items: products})
}

func (c *StoreController) GetProduct(ctx *gin.Context) {
	productID, err := strconv.ParseInt(ctx.Param("productID"), 10, 64)
	if err != nil || productID < 1 {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid product ID is required"})
		return
	}
	product, err := c.store.GetProduct(ctx.Request.Context(), productID)
	if errors.Is(err, repository.ErrProductNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "product not found"})
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load product"})
		return
	}
	ctx.JSON(http.StatusOK, product)
}

func (c *StoreController) CreateOrder(ctx *gin.Context) {
	var input data.CreateOrderInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid recipient, address and order items are required"})
		return
	}
	userID, ok := authenticatedUserID(ctx)
	if !ok {
		return
	}
	key, ok := validIdempotencyKey(ctx.GetHeader("Idempotency-Key"))
	if !ok {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key must be a UUID"})
		return
	}
	seen := make(map[int64]struct{}, len(input.Items))
	for _, item := range input.Items {
		if _, exists := seen[item.ProductID]; exists {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "duplicate product IDs are not allowed"})
			return
		}
		seen[item.ProductID] = struct{}{}
	}
	order, replayed, err := c.store.CreateOrder(ctx.Request.Context(), userID, key, input)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrDuplicateOrderProduct), errors.Is(err, repository.ErrInvalidOrderInput):
			ctx.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, repository.ErrIdempotencyConflict), errors.Is(err, repository.ErrProductUnavailable):
			ctx.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not create order"})
		}
		return
	}
	if replayed {
		ctx.Header("Idempotency-Replayed", "true")
		ctx.JSON(http.StatusOK, order)
		return
	}
	ctx.JSON(http.StatusCreated, order)
}

var idempotencyKeyPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func validIdempotencyKey(value string) (string, bool) {
	key := strings.TrimSpace(value)
	return strings.ToLower(key), idempotencyKeyPattern.MatchString(key)
}

func authenticatedUserID(ctx *gin.Context) (int64, bool) {
	value, exists := ctx.Get("user_id")
	userID, ok := value.(int64)
	if !exists || !ok || userID < 1 {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": "sign in is required"})
		return 0, false
	}
	return userID, true
}

func (c *StoreController) CustomerOrders(ctx *gin.Context) {
	userID, ok := authenticatedUserID(ctx)
	if !ok {
		return
	}
	page, pageSize, ok := orderPagination(ctx)
	if !ok {
		return
	}
	orders, total, err := c.store.ListOrders(ctx.Request.Context(), userID, page, pageSize)
	if err != nil {
		if errors.Is(err, repository.ErrInvalidOrderInput) {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid pagination"})
			return
		}
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load orders"})
		return
	}
	ctx.JSON(http.StatusOK, data.OrderPage{Items: orders, Page: page, PageSize: pageSize, Total: total})
}

func (c *StoreController) CustomerOrder(ctx *gin.Context) {
	userID, ok := authenticatedUserID(ctx)
	if !ok {
		return
	}
	orderID, ok := parsePositiveID(ctx, "orderID")
	if !ok {
		return
	}
	order, err := c.store.GetOrder(ctx.Request.Context(), userID, orderID)
	if errors.Is(err, repository.ErrOrderNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load order"})
		return
	}
	ctx.JSON(http.StatusOK, order)
}

func (c *StoreController) CancelCustomerOrder(ctx *gin.Context) {
	userID, ok := authenticatedUserID(ctx)
	if !ok {
		return
	}
	orderID, ok := parsePositiveID(ctx, "orderID")
	if !ok {
		return
	}
	order, err := c.store.CancelOrder(ctx.Request.Context(), userID, orderID)
	if errors.Is(err, repository.ErrOrderNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
		return
	}
	if errors.Is(err, repository.ErrInvalidOrderTransition) {
		ctx.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not cancel order"})
		return
	}
	ctx.JSON(http.StatusOK, order)
}

func (c *StoreController) UpdateAdminOrderStatus(ctx *gin.Context) {
	orderID, ok := parsePositiveID(ctx, "orderID")
	if !ok {
		return
	}
	var input data.UpdateOrderStatusInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid status is required"})
		return
	}
	status := data.NormalizeOrderStatus(input.Status)
	if !data.IsOrderMutationStatus(status) {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid status is required"})
		return
	}
	order, err := c.store.UpdateOrderStatus(ctx.Request.Context(), orderID, status)
	if errors.Is(err, repository.ErrOrderNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
		return
	}
	if errors.Is(err, repository.ErrInvalidOrderTransition) {
		ctx.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not update order"})
		return
	}
	ctx.JSON(http.StatusOK, order)
}

func (c *StoreController) AdminOrder(ctx *gin.Context) {
	orderID, ok := parsePositiveID(ctx, "orderID")
	if !ok {
		return
	}
	order, err := c.store.GetAdminOrder(ctx.Request.Context(), orderID)
	if errors.Is(err, repository.ErrOrderNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load order"})
		return
	}
	ctx.JSON(http.StatusOK, order)
}

func orderPagination(ctx *gin.Context) (int, int, bool) {
	page, err := strconv.Atoi(ctx.DefaultQuery("page", "1"))
	if err != nil || page < 1 {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "page must be a positive integer"})
		return 0, 0, false
	}
	pageSize, err := strconv.Atoi(ctx.DefaultQuery("pageSize", "20"))
	if err != nil || pageSize < 1 || pageSize > 100 {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "pageSize must be between 1 and 100"})
		return 0, 0, false
	}
	if page > math.MaxInt/pageSize {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "page is too large"})
		return 0, 0, false
	}
	return page, pageSize, true
}

func adminOrderFilter(ctx *gin.Context) (data.OrderFilter, bool) {
	filter := data.OrderFilter{}
	status := data.NormalizeOrderStatus(ctx.Query("status"))
	if status == "all" {
		status = ""
	}
	if status != "" {
		if !data.IsValidOrderStatus(status) {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid status is required"})
			return data.OrderFilter{}, false
		}
		filter.Status = status
	}
	filter.Query = strings.TrimSpace(ctx.Query("q"))
	if utf8.RuneCountInString(filter.Query) > 100 {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "search query is too long"})
		return data.OrderFilter{}, false
	}
	return filter, true
}

func (c *StoreController) AdminProducts(ctx *gin.Context) {
	products, err := c.store.ListProducts(ctx.Request.Context(), true)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load products"})
		return
	}
	ctx.JSON(http.StatusOK, data.ProductList{Items: products})
}

func writeProductError(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrInvalidProductInput):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid product details"})
	case errors.Is(err, repository.ErrInvalidDiscountSchedule):
		ctx.JSON(http.StatusUnprocessableEntity, gin.H{"error": "discount price and schedule are invalid"})
	case errors.Is(err, repository.ErrSKUConflict):
		ctx.JSON(http.StatusConflict, gin.H{"error": "SKU already exists", "code": "SKU_CONFLICT"})
	default:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not save product"})
	}
}

func (c *StoreController) CreateProduct(ctx *gin.Context) {
	var input data.CreateProductInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid product name and price are required"})
		return
	}
	product, err := c.store.CreateProduct(ctx.Request.Context(), input)
	if err != nil {
		writeProductError(ctx, err)
		return
	}
	ctx.JSON(http.StatusCreated, product)
}

func (c *StoreController) UpdateProduct(ctx *gin.Context) {
	id, ok := parsePositiveID(ctx, "productID")
	if !ok {
		return
	}
	var input data.CreateProductInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid product name and price are required"})
		return
	}
	product, err := c.store.UpdateProduct(ctx.Request.Context(), id, input)
	if errors.Is(err, repository.ErrProductNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "product not found"})
		return
	}
	if err != nil {
		writeProductError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, product)
}

func (c *StoreController) DeleteProduct(ctx *gin.Context) {
	id, ok := parsePositiveID(ctx, "productID")
	if !ok {
		return
	}
	if err := c.store.DeleteProduct(ctx.Request.Context(), id); errors.Is(err, repository.ErrProductNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "product not found"})
		return
	} else if errors.Is(err, repository.ErrProductHasStockHistory) {
		ctx.JSON(http.StatusConflict, gin.H{"error": "product has stock adjustment history and cannot be deleted"})
		return
	} else if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete product"})
		return
	}
	ctx.Status(http.StatusNoContent)
}

func (c *StoreController) AdminOrders(ctx *gin.Context) {
	page, pageSize, ok := orderPagination(ctx)
	if !ok {
		return
	}
	filter, ok := adminOrderFilter(ctx)
	if !ok {
		return
	}
	orders, total, err := c.store.AdminOrdersFiltered(ctx.Request.Context(), page, pageSize, filter)
	if err != nil {
		if errors.Is(err, repository.ErrInvalidOrderStatus) || errors.Is(err, repository.ErrInvalidOrderInput) {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid order filter or pagination"})
			return
		}
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load orders"})
		return
	}
	ctx.JSON(http.StatusOK, data.OrderPage{Items: orders, Page: page, PageSize: pageSize, Total: total})
}

func (c *StoreController) DashboardStats(ctx *gin.Context) {
	stats, err := c.store.DashboardStats(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load dashboard"})
		return
	}
	ctx.JSON(http.StatusOK, stats)
}
