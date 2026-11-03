package route

import (
	"net/http"
	"os"
	"strings"

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
	customers.GET("/orders/:orderID", storeController.CustomerOrder)
	customers.POST("/orders/:orderID/cancel", storeController.CancelCustomerOrder)

	admins := protected.Group("/admin")
	admins.Use(middleware.RequireRole("admin"))
	admins.GET("/dashboard", storeController.DashboardStats)
	admins.GET("/products", storeController.AdminProducts)
	admins.POST("/products", storeController.CreateProduct)
	admins.PUT("/products/:productID", storeController.UpdateProduct)
	admins.DELETE("/products/:productID", storeController.DeleteProduct)
	admins.POST("/products/:productID/stock-adjustments", storeController.AdjustProductStock)
	admins.GET("/settings/delivery", storeController.GetDeliverySettings)
	admins.PUT("/settings/delivery", storeController.UpdateDeliverySettings)
	admins.POST("/categories", storeController.CreateCategory)
	admins.PUT("/categories/:categoryID", storeController.UpdateCategory)
	admins.DELETE("/categories/:categoryID", storeController.DeleteCategory)
	admins.GET("/orders", storeController.AdminOrders)
	admins.GET("/orders/:orderID", storeController.AdminOrder)
	admins.PATCH("/orders/:orderID/status", storeController.UpdateAdminOrderStatus)
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
	allowedOrigin := strings.TrimSpace(origin)
	wildcard := IsWildcardOrigin(allowedOrigin)
	return func(ctx *gin.Context) {
		requestOrigin := strings.TrimSpace(ctx.GetHeader("Origin"))
		originAllowed := false
		if allowedOrigin != "" {
			ctx.Writer.Header().Add("Vary", "Origin")
		}
		switch {
		case wildcard:
			// A wildcard origin cannot be combined with credentials.
			ctx.Header("Access-Control-Allow-Origin", "*")
			originAllowed = true
		case allowedOrigin != "" && requestOrigin != "" && strings.EqualFold(requestOrigin, allowedOrigin):
			ctx.Header("Access-Control-Allow-Origin", allowedOrigin)
			ctx.Header("Access-Control-Allow-Credentials", "true")
			originAllowed = true
		}
		if originAllowed {
			ctx.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
			ctx.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			ctx.Header("Access-Control-Expose-Headers", "Idempotency-Replayed")
			ctx.Header("Access-Control-Max-Age", "43200")
		}
		if ctx.Request.Method == http.MethodOptions {
			ctx.Writer.Header().Add("Vary", "Access-Control-Request-Method")
			ctx.Writer.Header().Add("Vary", "Access-Control-Request-Headers")
			ctx.AbortWithStatus(http.StatusNoContent)
			return
		}
		ctx.Next()
	}
}

func IsWildcardOrigin(origin string) bool { return strings.TrimSpace(origin) == "*" }
