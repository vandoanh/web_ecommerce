package controller

import (
	"errors"
	"net/http"
	"strings"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/gin-gonic/gin"
)

// AdjustProductStock applies an audited signed stock change. The authenticated
// admin is recorded as the actor.
func (c *StoreController) AdjustProductStock(ctx *gin.Context) {
	productID, ok := parsePositiveID(ctx, "productID")
	if !ok {
		return
	}
	actorUserID, ok := authenticatedUserID(ctx)
	if !ok {
		return
	}
	var input data.StockAdjustmentInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid stock delta and reason are required"})
		return
	}
	if strings.TrimSpace(input.IdempotencyKey) != "" {
		key, valid := validIdempotencyKey(input.IdempotencyKey)
		if !valid {
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "idempotencyKey must be a UUID"})
			return
		}
		input.IdempotencyKey = key
	}
	result, err := c.store.AdjustProductStock(ctx.Request.Context(), productID, actorUserID, input)
	switch {
	case errors.Is(err, repository.ErrProductNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": "product not found"})
	case errors.Is(err, repository.ErrInvalidStockAdjustment):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid non-zero delta and reason are required"})
	case errors.Is(err, repository.ErrInsufficientStock):
		ctx.JSON(http.StatusConflict, gin.H{"error": "stock adjustment would make stock negative"})
	case errors.Is(err, repository.ErrStockOverflow):
		ctx.JSON(http.StatusConflict, gin.H{"error": "stock adjustment exceeds the supported stock range"})
	case errors.Is(err, repository.ErrStockIdempotencyConflict):
		ctx.JSON(http.StatusConflict, gin.H{"error": "idempotencyKey was already used with a different stock adjustment"})
	case err != nil:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not adjust stock"})
	default:
		ctx.JSON(http.StatusOK, result)
	}
}
