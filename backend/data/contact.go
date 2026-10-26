package data

import "time"

// CreateContactInput contains the details submitted from the public contact page.
type CreateContactInput struct {
	Name        string `json:"name" binding:"required,max=255"`
	Phone       string `json:"phone" binding:"required,max=32"`
	Address     string `json:"address" binding:"required,max=2000"`
	MapLocation string `json:"mapLocation" binding:"required,max=2048"`
}

// Contact is a saved contact request together with its Google Maps location.
type Contact struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Phone       string    `json:"phone"`
	Address     string    `json:"address"`
	MapLocation string    `json:"mapLocation"`
	CreatedAt   time.Time `json:"createdAt"`
}
