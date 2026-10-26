package controller

import (
	"errors"
	"os"
	"net/http"
	"strconv"

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
	userID, ok := ctx.Get("user_id")
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": "sign in is required"})
		return
	}
	order, err := c.store.CreateOrder(ctx.Request.Context(), userID.(int64), input)
	if err != nil {
		ctx.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	ctx.JSON(http.StatusCreated, order)
}

func (c *StoreController) CustomerOrders(ctx *gin.Context) {
	userID, ok := ctx.Get("user_id")
	if !ok {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": "sign in is required"})
		return
	}
	orders, err := c.store.ListOrders(ctx.Request.Context(), userID.(int64))
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load orders"})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"items": orders})
}

func (c *StoreController) AdminProducts(ctx *gin.Context) {
	products, err := c.store.ListProducts(ctx.Request.Context(), true)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load products"})
		return
	}
	ctx.JSON(http.StatusOK, data.ProductList{Items: products})
}

func (c *StoreController) CreateProduct(ctx *gin.Context) {
	var input data.CreateProductInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid SKU, name, price and stock are required"})
		return
	}
	product, err := c.store.CreateProduct(ctx.Request.Context(), input)
	if err != nil {
		ctx.JSON(http.StatusConflict, gin.H{"error": "SKU already exists or product could not be saved"})
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
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid SKU, name, price and stock are required"})
		return
	}
	product, err := c.store.UpdateProduct(ctx.Request.Context(), id, input)
	if errors.Is(err, repository.ErrProductNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "product not found"})
		return
	}
	if err != nil {
		ctx.JSON(http.StatusConflict, gin.H{"error": "SKU already exists or product could not be saved"})
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
	} else if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete product"})
		return
	}
	ctx.Status(http.StatusNoContent)
}

func (c *StoreController) AdminOrders(ctx *gin.Context) {
	orders, err := c.store.ListOrders(ctx.Request.Context(), 0)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load orders"})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"items": orders})
}

func (c *StoreController) DashboardStats(ctx *gin.Context) {
	stats, err := c.store.DashboardStats(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load dashboard"})
		return
	}
	ctx.JSON(http.StatusOK, stats)
}
