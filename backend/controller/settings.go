package controller

import (
	"errors"
	"net/http"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/gin-gonic/gin"
)

func (c *StoreController) GetDeliverySettings(ctx *gin.Context) {
	settings, err := c.store.GetDeliverySettings(ctx.Request.Context())
	if errors.Is(err, repository.ErrDeliverySettingsNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "delivery settings not found"})
		return
	}
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load delivery settings"})
		return
	}
	ctx.JSON(http.StatusOK, settings)
}

func (c *StoreController) UpdateDeliverySettings(ctx *gin.Context) {
	var input data.UpdateDeliverySettingsInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "valid delivery settings are required"})
		return
	}
	if input.ExpectedVersion == nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "expectedVersion is required"})
		return
	}
	settings, err := c.store.UpdateDeliverySettings(ctx.Request.Context(), input)
	switch {
	case errors.Is(err, repository.ErrDeliveryVersionConflict):
		ctx.JSON(http.StatusConflict, gin.H{"error": "delivery settings were updated by another request", "code": "VERSION_CONFLICT"})
	case errors.Is(err, repository.ErrDeliverySettingsNotFound):
		ctx.JSON(http.StatusNotFound, gin.H{"error": "delivery settings not found"})
	case errors.Is(err, repository.ErrInvalidDeliverySettings):
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "invalid delivery settings"})
	case err != nil:
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not save delivery settings"})
	default:
		ctx.JSON(http.StatusOK, settings)
	}
}
