package model

import (
	"errors"
	"math"
	"testing"
	"time"

	"github.com/example/youtube-dashboard-go-next/backend/controller/repository"
	"github.com/example/youtube-dashboard-go-next/backend/data"
)

func int64Ptr(value int64) *int64 { return &value }

func timePtr(value time.Time) *time.Time { return &value }

func TestGenerateProductSKUFormatAndRandomness(t *testing.T) {
	seen := make(map[string]struct{}, 50)
	for i := 0; i < 50; i++ {
		sku, err := generateProductSKU()
		if err != nil {
			t.Fatal(err)
		}
		if !isValidGeneratedProductSKU(sku) {
			t.Fatalf("generated SKU %q does not match TK + 10 uppercase alphanumerics", sku)
		}
		if len(sku) != 12 {
			t.Fatalf("generated SKU %q has length %d, want 12", sku, len(sku))
		}
		if _, exists := seen[sku]; exists {
			t.Fatalf("generated SKU collision in small sample: %q", sku)
		}
		seen[sku] = struct{}{}
	}
}

func TestNormalizeProductFieldsAcceptsLegacyAndScheduledPrices(t *testing.T) {
	legacy, err := normalizeProductFields(data.CreateProductInput{Name: "  Bánh mì  ", PriceVND: 50000, Stock: 3})
	if err != nil {
		t.Fatal(err)
	}
	if legacy.Name != "Bánh mì" || legacy.RegularPriceVND != 50000 || legacy.Stock != 3 || !legacy.IsActive {
		t.Fatalf("unexpected legacy normalization: %+v", legacy)
	}
	if legacy.DiscountPriceVND != nil || legacy.DiscountStartsAt != nil || legacy.DiscountEndsAt != nil {
		t.Fatalf("discount fields must stay empty when omitted: %+v", legacy)
	}

	start := time.Date(2026, 11, 3, 0, 0, 0, 0, time.FixedZone("ICT", 7*60*60))
	end := start.Add(7 * 24 * time.Hour)
	scheduled, err := normalizeProductFields(data.CreateProductInput{
		Name:             "Bánh mì",
		RegularPriceVND:  int64Ptr(50000),
		PriceVND:         50000,
		DiscountPriceVND: int64Ptr(45000),
		DiscountStartsAt: timePtr(start),
		DiscountEndsAt:   timePtr(end),
	})
	if err != nil {
		t.Fatal(err)
	}
	if scheduled.RegularPriceVND != 50000 || scheduled.DiscountPriceVND == nil || *scheduled.DiscountPriceVND != 45000 {
		t.Fatalf("unexpected scheduled prices: %+v", scheduled)
	}
	if scheduled.DiscountStartsAt == nil || scheduled.DiscountStartsAt.Location() != time.UTC {
		t.Fatalf("discount start must be normalized to UTC: %+v", scheduled.DiscountStartsAt)
	}
	if !scheduled.DiscountStartsAt.Equal(start) || !scheduled.DiscountEndsAt.Equal(end) {
		t.Fatalf("discount instants changed during normalization: %+v", scheduled)
	}
}

func TestNormalizeProductFieldsRejectsInvalidInput(t *testing.T) {
	start := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	valid := data.CreateProductInput{Name: "Item", PriceVND: 10000}
	cases := []struct {
		name  string
		input data.CreateProductInput
		want  error
	}{
		{name: "blank name", input: data.CreateProductInput{Name: "  ", PriceVND: 10000}, want: repository.ErrInvalidProductInput},
		{name: "missing price", input: data.CreateProductInput{Name: "Item"}, want: repository.ErrInvalidProductInput},
		{name: "conflicting legacy and regular price", input: data.CreateProductInput{Name: "Item", PriceVND: 10000, RegularPriceVND: int64Ptr(20000)}, want: repository.ErrInvalidProductInput},
		{name: "negative stock", input: data.CreateProductInput{Name: "Item", PriceVND: 10000, Stock: -1}, want: repository.ErrInvalidProductInput},
		{name: "duplicate categories", input: data.CreateProductInput{Name: "Item", PriceVND: 10000, CategoryIDs: []int64{1, 1}}, want: repository.ErrInvalidProductInput},
		{name: "incomplete discount", input: data.CreateProductInput{Name: "Item", PriceVND: 10000, DiscountPriceVND: int64Ptr(9000)}, want: repository.ErrInvalidDiscountSchedule},
		{name: "discount equals regular", input: data.CreateProductInput{Name: "Item", PriceVND: 10000, DiscountPriceVND: int64Ptr(10000), DiscountStartsAt: timePtr(start), DiscountEndsAt: timePtr(end)}, want: repository.ErrInvalidDiscountSchedule},
		{name: "discount above regular", input: data.CreateProductInput{Name: "Item", PriceVND: 10000, DiscountPriceVND: int64Ptr(11000), DiscountStartsAt: timePtr(start), DiscountEndsAt: timePtr(end)}, want: repository.ErrInvalidDiscountSchedule},
		{name: "zero discount", input: data.CreateProductInput{Name: "Item", PriceVND: 10000, DiscountPriceVND: int64Ptr(0), DiscountStartsAt: timePtr(start), DiscountEndsAt: timePtr(end)}, want: repository.ErrInvalidDiscountSchedule},
		{name: "end equals start", input: data.CreateProductInput{Name: "Item", PriceVND: 10000, DiscountPriceVND: int64Ptr(9000), DiscountStartsAt: timePtr(start), DiscountEndsAt: timePtr(start)}, want: repository.ErrInvalidDiscountSchedule},
		{name: "end before start", input: data.CreateProductInput{Name: "Item", PriceVND: 10000, DiscountPriceVND: int64Ptr(9000), DiscountStartsAt: timePtr(end), DiscountEndsAt: timePtr(start)}, want: repository.ErrInvalidDiscountSchedule},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := normalizeProductFields(tt.input); !errors.Is(err, tt.want) {
				t.Fatalf("normalizeProductFields() error = %v, want %v", err, tt.want)
			}
		})
	}
	if _, err := normalizeProductFields(valid); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
}

func TestApplyStockDelta(t *testing.T) {
	cases := []struct {
		name  string
		stock int64
		delta int64
		want  int64
		err   error
	}{
		{name: "decrement", stock: 10, delta: -2, want: 8},
		{name: "increment", stock: 0, delta: 5, want: 5},
		{name: "zero delta", stock: 10, delta: 0, err: repository.ErrInvalidStockAdjustment},
		{name: "negative result", stock: 1, delta: -2, err: repository.ErrInsufficientStock},
		{name: "max int32", stock: 0, delta: math.MaxInt32, want: math.MaxInt32},
		{name: "overflow int32", stock: 1, delta: math.MaxInt32, err: repository.ErrStockOverflow},
		{name: "delta beyond int32", stock: 0, delta: math.MaxInt32 + 1, err: repository.ErrStockOverflow},
		{name: "large negative delta", stock: 0, delta: math.MinInt32, err: repository.ErrInsufficientStock},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got, err := applyStockDelta(tt.stock, tt.delta)
			if !errors.Is(err, tt.err) {
				t.Fatalf("applyStockDelta() error = %v, want %v", err, tt.err)
			}
			if err == nil && got != tt.want {
				t.Fatalf("applyStockDelta() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestStockAdjustmentRequestHashIsCanonical(t *testing.T) {
	first, err := stockAdjustmentRequestHash(1, -2, "damaged")
	if err != nil {
		t.Fatal(err)
	}
	second, err := stockAdjustmentRequestHash(1, -2, "damaged")
	if err != nil {
		t.Fatal(err)
	}
	if first != second || len(first) != 64 {
		t.Fatalf("hash must be stable and SHA-256 sized: %q vs %q", first, second)
	}
	for _, changed := range []struct {
		productID int64
		delta     int64
		reason    string
	}{{2, -2, "damaged"}, {1, -3, "damaged"}, {1, -2, "expired"}} {
		hash, err := stockAdjustmentRequestHash(changed.productID, changed.delta, changed.reason)
		if err != nil {
			t.Fatal(err)
		}
		if hash == first {
			t.Fatalf("changed request must change hash: %+v", changed)
		}
	}
}
