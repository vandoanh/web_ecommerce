package controller

import (
	"crypto/rand"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

const (
	maxImageSize  = 8 << 20
	maxUploadSize = 50 << 20
	maxImageCount = 10
)

func (c *StoreController) UploadProductImages(ctx *gin.Context) {
	ctx.Request.Body = http.MaxBytesReader(ctx.Writer, ctx.Request.Body, maxUploadSize)
	if err := ctx.Request.ParseMultipartForm(8 << 20); err != nil {
		ctx.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "upload size limit exceeded"})
		return
	}
	if ctx.Request.MultipartForm == nil {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "select product images"})
		return
	}
	defer ctx.Request.MultipartForm.RemoveAll()
	files := ctx.Request.MultipartForm.File["images"]
	if len(files) == 0 || len(files) > maxImageCount {
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "select between 1 and 10 images"})
		return
	}
	if err := os.MkdirAll(c.UploadDir, 0755); err != nil {
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "image storage is unavailable"})
		return
	}

	urls := make([]string, 0, len(files))
	paths := make([]string, 0, len(files))
	cleanup := func() {
		for _, path := range paths {
			_ = os.Remove(path)
		}
	}
	for _, header := range files {
		if header.Size > maxImageSize {
			cleanup()
			ctx.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "each image must be 8 MB or smaller"})
			return
		}
		file, err := header.Open()
		if err != nil {
			cleanup()
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "could not read uploaded image"})
			return
		}
		headerBytes := make([]byte, 512)
		n, _ := io.ReadFull(file, headerBytes)
		contentType := http.DetectContentType(headerBytes[:n])
		extension, ok := map[string]string{
			"image/jpeg": ".jpg",
			"image/png":  ".png",
			"image/webp": ".webp",
			"image/gif":  ".gif",
		}[contentType]
		if !ok {
			file.Close()
			cleanup()
			ctx.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "only JPEG, PNG, WebP and GIF images are supported"})
			return
		}
		if _, err = file.Seek(0, io.SeekStart); err != nil {
			file.Close()
			cleanup()
			ctx.JSON(http.StatusBadRequest, gin.H{"error": "could not read uploaded image"})
			return
		}
		nameBytes := make([]byte, 16)
		if _, err = rand.Read(nameBytes); err != nil {
			file.Close()
			cleanup()
			ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not save uploaded image"})
			return
		}
		path := filepath.Join(c.UploadDir, hex.EncodeToString(nameBytes)+extension)
		destination, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
		if err != nil {
			file.Close()
			cleanup()
			ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not save uploaded image"})
			return
		}
		paths = append(paths, path)
		_, copyErr := io.Copy(destination, file)
		closeDestinationErr := destination.Close()
		closeFileErr := file.Close()
		if copyErr != nil || closeDestinationErr != nil || closeFileErr != nil {
			cleanup()
			ctx.JSON(http.StatusInternalServerError, gin.H{"error": "could not save uploaded image"})
			return
		}
		urls = append(urls, "/uploads/"+filepath.Base(path))
	}
	ctx.JSON(http.StatusCreated, gin.H{"items": urls})
}
