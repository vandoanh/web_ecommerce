package model

import (
	"strings"
	"testing"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
)

func TestOrderRequestHashIsCanonical(t *testing.T) {
	left := data.CreateOrderInput{
		RecipientName:   "Buyer",
		Phone:           "123",
		ShippingAddress: "Address",
		Items: []data.OrderLineInput{
			{ProductID: 2, Quantity: 1},
			{ProductID: 1, Quantity: 3},
		},
	}
	right := left
	right.Items = []data.OrderLineInput{
		{ProductID: 1, Quantity: 3},
		{ProductID: 2, Quantity: 1},
	}
	leftHash, err := orderRequestHash(left)
	if err != nil {
		t.Fatal(err)
	}
	rightHash, err := orderRequestHash(right)
	if err != nil {
		t.Fatal(err)
	}
	if leftHash != rightHash || len(leftHash) != 64 {
		t.Fatalf("hash should be stable and SHA-256 sized: %q vs %q", leftHash, rightHash)
	}
	right.Phone = "456"
	changedHash, err := orderRequestHash(right)
	if err != nil {
		t.Fatal(err)
	}
	if changedHash == leftHash {
		t.Fatal("payload changes must change the request hash")
	}
}

func TestValidateOrderInputRejectsDuplicateAndInvalidLines(t *testing.T) {
	valid := data.CreateOrderInput{Items: []data.OrderLineInput{{ProductID: 1, Quantity: 1}}}
	if err := validateOrderInput(valid); err != nil {
		t.Fatalf("valid order rejected: %v", err)
	}
	duplicate := data.CreateOrderInput{Items: []data.OrderLineInput{{ProductID: 1, Quantity: 1}, {ProductID: 1, Quantity: 2}}}
	if err := validateOrderInput(duplicate); err != repository.ErrDuplicateOrderProduct {
		t.Fatalf("expected duplicate error, got %v", err)
	}
	tooMany := data.CreateOrderInput{Items: make([]data.OrderLineInput, 101)}
	if err := validateOrderInput(tooMany); err != repository.ErrInvalidOrderInput {
		t.Fatalf("expected invalid order for too many lines, got %v", err)
	}
}

func TestNewOrderNumberFitsSchema(t *testing.T) {
	number, err := newOrderNumber()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(number, "ORD-") || len(number) > 32 {
		t.Fatalf("unexpected order number %q", number)
	}
}

func TestOrderWhereBuildsScopedAdminFilters(t *testing.T) {
	where, args, err := orderWhere(10, data.OrderFilter{Status: "Pending", Query: "an"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(where, "o.user_id = ?") || !strings.Contains(where, "o.status = ?") || !strings.Contains(where, "LOCATE(?, oi.product_name)") {
		t.Fatalf("unexpected where clause: %s", where)
	}
	if len(args) != 8 {
		t.Fatalf("expected user, status and six query args, got %d", len(args))
	}
	if _, _, err = orderWhere(0, data.OrderFilter{Status: "bogus"}); err != repository.ErrInvalidOrderStatus {
		t.Fatalf("expected invalid status error, got %v", err)
	}
}
