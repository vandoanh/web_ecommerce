package controller

import (
	"errors"
	"net/http"
	"strings"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/gin-gonic/gin"
)

type ContactController struct {
	contacts repository.ContactRepository
}

func NewContactController(contacts repository.ContactRepository) *ContactController {
	return &ContactController{contacts: contacts}
}

func (c *ContactController) Create(ctx *gin.Context) {
	var input data.CreateContactInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "name, phone, address and Google Maps location are required"})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Phone = strings.TrimSpace(input.Phone)
	input.Address = strings.TrimSpace(input.Address)
	input.MapLocation = strings.TrimSpace(input.MapLocation)
	if input.Name == "" || input.Phone == "" || input.Address == "" || input.MapLocation == "" {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "name, phone, address and Google Maps location are required"})
		return
	}
	contact, err := c.contacts.CreateContact(ctx.Request.Context(), input)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not save contact"})
		return
	}
	ctx.JSON(http.StatusCreated, contact)
}

func (c *ContactController) List(ctx *gin.Context) {
	contacts, err := c.contacts.ListContacts(ctx.Request.Context())
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not load contacts"})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"items": contacts})
}

func (c *ContactController) Delete(ctx *gin.Context) {
	id, ok := parsePositiveID(ctx, "contactID")
	if !ok {
		return
	}
	if err := c.contacts.DeleteContact(ctx.Request.Context(), id); errors.Is(err, repository.ErrContactNotFound) {
		ctx.JSON(http.StatusNotFound, gin.H{"error": "contact not found"})
		return
	} else if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete contact"})
		return
	}
	ctx.Status(http.StatusNoContent)
}
