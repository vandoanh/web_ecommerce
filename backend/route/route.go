package route

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/example/youtube-dashboard-go-next/backend/controller"
	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	authservice "github.com/example/youtube-dashboard-go-next/backend/controller/service"
	"github.com/example/youtube-dashboard-go-next/backend/middleware"
	"github.com/gin-gonic/gin"
)

func SetupRouter(users repository.UserRepository, store repository.StoreRepository, carts repository.CartRepository, contacts repository.ContactRepository, auth authservice.AuthService, corsOrigin string) *gin.Engine {
	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery(), cors(corsOrigin))
	router.GET("/healthz", func(ctx *gin.Context) { ctx.JSON(http.StatusOK, gin.H{"status": "ok"}) })

	api := router.Group("/api/v1")
	authController := controller.NewAuthController(users, auth)
	storeController := controller.NewStoreController(store)
	cartController := controller.NewCartController(carts)
	contactController := controller.NewContactController(contacts)
	api.POST("/auth/login", authController.LoginCustomer)
	api.POST("/auth/register", authController.RegisterCustomer)
	api.POST("/admin/auth/login", authController.LoginAdmin)
	api.GET("/products", storeController.ListProducts)
	api.GET("/products/:productID", storeController.GetProduct)
	api.GET("/categories", storeController.ListCategories)
	api.POST("/contacts", contactController.Create)
	api.GET("/cart/:cartID", cartController.Get)
	api.PUT("/cart/:cartID", cartController.Save)
	api.DELETE("/cart/:cartID", cartController.Clear)

	protected := api.Group("")
	protected.Use(middleware.NewAuthorized(auth).TokenAuthMiddleware())
	customers := protected.Group("")
	customers.Use(middleware.RequireRole("customer"))
	customers.POST("/orders", storeController.CreateOrder)
	customers.GET("/orders", storeController.CustomerOrders)

	admins := protected.Group("/admin")
	admins.Use(middleware.RequireRole("admin"))
	admins.GET("/dashboard", storeController.DashboardStats)
	admins.GET("/products", storeController.AdminProducts)
	admins.POST("/products", storeController.CreateProduct)
	admins.PUT("/products/:productID", storeController.UpdateProduct)
	admins.DELETE("/products/:productID", storeController.DeleteProduct)
	admins.POST("/categories", storeController.CreateCategory)
	admins.PUT("/categories/:categoryID", storeController.UpdateCategory)
	admins.DELETE("/categories/:categoryID", storeController.DeleteCategory)
	admins.GET("/orders", storeController.AdminOrders)
	admins.GET("/contacts", contactController.List)
	admins.DELETE("/contacts/:contactID", contactController.Delete)
	admins.POST("/product-images", storeController.UploadProductImages)
	uploadDir := storeController.UploadDir
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		panic(err)
	}
	router.Static("/uploads", uploadDir)
	return router
}

func cors(origin string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		if origin != "" {
			ctx.Header("Access-Control-Allow-Origin", origin)
			ctx.Header("Vary", "Origin")
		}
		ctx.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		ctx.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		ctx.Header("Access-Control-Allow-Credentials", "true")
		ctx.Header("Access-Control-Max-Age", (12 * time.Hour).String())
		if ctx.Request.Method == http.MethodOptions {
			ctx.AbortWithStatus(http.StatusNoContent)
			return
		}
		ctx.Next()
	}
}

func IsWildcardOrigin(origin string) bool { return strings.TrimSpace(origin) == "*" }
