package controller

import (
	"net/http"
	"regexp"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/gin-gonic/gin"
)

var cartIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type CartController struct{ carts repository.CartRepository }

func NewCartController(carts repository.CartRepository) *CartController {
	return &CartController{carts: carts}
}

func (c *CartController) Get(ctx *gin.Context) {
	cartID, ok := validCartID(ctx)
	if !ok {
		return
	}
	items, err := c.carts.GetCart(ctx.Request.Context(), cartID)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load cart"})
		return
	}
	ctx.JSON(http.StatusOK, data.Cart{Items: items})
}

func (c *CartController) Save(ctx *gin.Context) {
	cartID, ok := validCartID(ctx)
	if !ok {
		return
	}
	var cart data.Cart
	if err := ctx.ShouldBindJSON(&cart); err != nil || len(cart.Items) > 100 {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid cart items are required"})
		return
	}
	seen := make(map[int64]struct{}, len(cart.Items))
	for _, item := range cart.Items {
		if item.ProductID < 1 || item.Quantity < 1 || item.Quantity > 99 {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "cart item quantity must be between 1 and 99"})
			return
		}
		if _, exists := seen[item.ProductID]; exists {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "cart cannot contain duplicate products"})
			return
		}
		seen[item.ProductID] = struct{}{}
	}
	if err := c.carts.SaveCart(ctx.Request.Context(), cartID, cart.Items); err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not save cart"})
		return
	}
	ctx.JSON(http.StatusOK, cart)
}

func (c *CartController) Clear(ctx *gin.Context) {
	cartID, ok := validCartID(ctx)
	if !ok {
		return
	}
	if err := c.carts.ClearCart(ctx.Request.Context(), cartID); err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not clear cart"})
		return
	}
	ctx.Status(http.StatusNoContent)
}

func validCartID(ctx *gin.Context) (string, bool) {
	cartID := ctx.Param("cartID")
	if !cartIDPattern.MatchString(cartID) {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid cart ID is required"})
		return "", false
	}
	return cartID, true
}
