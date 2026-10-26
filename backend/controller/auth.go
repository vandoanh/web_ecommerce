package controller

import (
	"net/http"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	authservice "github.com/example/youtube-dashboard-go-next/backend/controller/service"
	"github.com/example/youtube-dashboard-go-next/backend/data"
	"github.com/gin-gonic/gin"
)

type AuthController struct {
	userRepository repository.UserRepository
	userRegistrar  authservice.UserRegistrar
	authService    authservice.AuthService
}

func NewAuthController(repo repository.UserRepository, auth authservice.AuthService) *AuthController {
	registrar, _ := repo.(authservice.UserRegistrar)
	return &AuthController{userRepository: repo, userRegistrar: registrar, authService: auth}
}

func (c *AuthController) LoginCustomer(ctx *gin.Context) { c.login(ctx, "customer") }

func (c *AuthController) LoginAdmin(ctx *gin.Context) { c.login(ctx, "admin") }

func (c *AuthController) login(ctx *gin.Context, requiredRole string) {
	var input data.LoginInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "username and password are required"})
		return
	}
	user, err := c.userRepository.FindUserByUsernameAndPassword(input.Username, input.Password)
	if err != nil {
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	if !hasRole(*user, requiredRole) {
		ctx.JSON(http.StatusForbidden, gin.H{"error": "this account cannot sign in here"})
		return
	}
	c.respondWithToken(ctx, *user)
}

func (c *AuthController) RegisterCustomer(ctx *gin.Context) {
	if c.userRegistrar == nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "registration is unavailable"})
		return
	}
	var input data.RegisterInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "username, valid email and password of at least 8 characters are required"})
		return
	}
	user, err := c.userRegistrar.RegisterCustomer(ctx.Request.Context(), input)
	if err != nil {
		ctx.JSON(http.StatusConflict, gin.H{"error": "username or email is already in use"})
		return
	}
	c.respondWithToken(ctx, *user)
}

func (c *AuthController) respondWithToken(ctx *gin.Context, user data.User) {
	token, err := c.authService.GenerateToken(user)
	if err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not issue token"})
		return
	}
	ctx.JSON(http.StatusOK, data.TokenResponse{AccessToken: token, TokenType: "Bearer", ExpiresIn: 1800, User: user})
}

func hasRole(user data.User, role string) bool {
	for _, value := range user.Roles {
		if value == role {
			return true
		}
	}
	return false
}
