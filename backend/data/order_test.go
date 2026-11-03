package data

import "testing"

func TestOrderStatusValidation(t *testing.T) {
	for _, status := range OrderStatuses() {
		if !IsValidOrderStatus(status) {
			t.Errorf("expected %q to be valid", status)
		}
	}
	for _, status := range []string{"", "shipping", "refunded"} {
		if IsValidOrderStatus(status) {
			t.Errorf("expected %q to be invalid", status)
		}
	}
	if !IsValidOrderStatus(" Pending ") {
		t.Error("status normalization should accept surrounding whitespace")
	}
}

func TestOrderMutationStatusValidation(t *testing.T) {
	for _, status := range []string{"processing", "shipped", "completed", "cancelled", " SHIPPED "} {
		if !IsOrderMutationStatus(status) {
			t.Errorf("expected %q to be a valid mutation target", status)
		}
	}
	for _, status := range []string{"", "pending", "paid", "shipping"} {
		if IsOrderMutationStatus(status) {
			t.Errorf("expected %q not to be a valid mutation target", status)
		}
	}
}

func TestOrderStatusTransitions(t *testing.T) {
	allowed := [][2]string{
		{"pending", "processing"},
		{"pending", "cancelled"},
		{"processing", "shipped"},
		{"processing", "cancelled"},
		{"shipped", "completed"},
		{"pending", "pending"},
		{"cancelled", "cancelled"},
	}
	for _, transition := range allowed {
		if !CanTransitionOrderStatus(transition[0], transition[1]) {
			t.Errorf("expected %s -> %s to be allowed", transition[0], transition[1])
		}
	}
	denied := [][2]string{
		{"pending", "shipped"},
		{"pending", "completed"},
		{"processing", "completed"},
		{"shipped", "cancelled"},
		{"completed", "cancelled"},
		{"cancelled", "pending"},
		{"paid", "processing"},
		{"bogus", "pending"},
	}
	for _, transition := range denied {
		if CanTransitionOrderStatus(transition[0], transition[1]) {
			t.Errorf("expected %s -> %s to be denied", transition[0], transition[1])
		}
	}
}
