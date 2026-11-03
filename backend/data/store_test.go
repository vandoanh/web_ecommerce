package data

import (
	"testing"
	"time"
)

func TestEffectiveProductPriceVNDUsesHalfOpenInterval(t *testing.T) {
	start := time.Date(2026, 11, 3, 0, 0, 0, 0, time.FixedZone("ICT", 7*60*60))
	end := time.Date(2026, 11, 10, 0, 0, 0, 0, time.FixedZone("ICT", 7*60*60))
	discount := int64(45000)
	regular := int64(50000)

	cases := []struct {
		name string
		now  time.Time
		want int64
	}{
		{name: "before start", now: start.Add(-time.Nanosecond), want: regular},
		{name: "at start", now: start, want: discount},
		{name: "inside window", now: start.Add(24 * time.Hour), want: discount},
		{name: "just before end", now: end.Add(-time.Nanosecond), want: discount},
		{name: "at end", now: end, want: regular},
		{name: "after end", now: end.Add(time.Nanosecond), want: regular},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := EffectiveProductPriceVND(regular, &discount, &start, &end, tt.now); got != tt.want {
				t.Fatalf("effective price = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestEffectiveProductPriceVNDWithoutCompleteSchedule(t *testing.T) {
	now := time.Date(2026, 11, 3, 0, 0, 0, 0, time.UTC)
	discount := int64(45000)
	if got := EffectiveProductPriceVND(50000, &discount, nil, nil, now); got != 50000 {
		t.Fatalf("discount without schedule must fall back to regular price, got %d", got)
	}
	if got := EffectiveProductPriceVND(50000, nil, nil, nil, now); got != 50000 {
		t.Fatalf("missing discount must fall back to regular price, got %d", got)
	}
}
