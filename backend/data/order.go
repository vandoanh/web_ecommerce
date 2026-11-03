package data

import "strings"

// Order statuses supported by the storefront checkout and admin order flow.
const (
	OrderStatusPending    = "pending"
	OrderStatusProcessing = "processing"
	OrderStatusPaid       = "paid"
	OrderStatusShipped    = "shipped"
	OrderStatusCompleted  = "completed"
	OrderStatusCancelled  = "cancelled"
)

var orderStatuses = map[string]struct{}{
	OrderStatusPending:    {},
	OrderStatusProcessing: {},
	OrderStatusPaid:       {},
	OrderStatusShipped:    {},
	OrderStatusCompleted:  {},
	OrderStatusCancelled:  {},
}

// orderMutationStatuses are the only targets accepted by the admin mutation
// API. pending and paid are not mutation targets; paid is retained for legacy
// rows and status filtering only.
var orderMutationStatuses = map[string]struct{}{
	OrderStatusProcessing: {},
	OrderStatusShipped:    {},
	OrderStatusCompleted:  {},
	OrderStatusCancelled:  {},
}

// orderTransitions is the order lifecycle accepted by the admin mutation API.
// Cancelling restores stock; completed and cancelled are terminal. Repeating the
// current status is handled as an idempotent no-op before this map is consulted.
var orderTransitions = map[string]map[string]struct{}{
	OrderStatusPending: {
		OrderStatusProcessing: {},
		OrderStatusCancelled:  {},
	},
	OrderStatusProcessing: {
		OrderStatusShipped:   {},
		OrderStatusCancelled: {},
	},
	OrderStatusShipped: {
		OrderStatusCompleted: {},
	},
}

// OrderFilter contains admin-only server-side order filters.
type OrderFilter struct {
	Status string
	Query  string
}

// UpdateOrderStatusInput is the admin order status mutation body.
type UpdateOrderStatusInput struct {
	Status string `json:"status" binding:"required,max=32"`
}

// NormalizeOrderStatus produces the canonical lower-case status value.
func NormalizeOrderStatus(status string) string {
	return strings.ToLower(strings.TrimSpace(status))
}

// IsValidOrderStatus reports whether status is a known persisted order status.
func IsValidOrderStatus(status string) bool {
	_, ok := orderStatuses[NormalizeOrderStatus(status)]
	return ok
}

// IsOrderMutationStatus reports whether status is a valid admin mutation target.
func IsOrderMutationStatus(status string) bool {
	_, ok := orderMutationStatuses[NormalizeOrderStatus(status)]
	return ok
}

// CanTransitionOrderStatus validates the admin lifecycle transition. The same
// valid status is idempotent.
func CanTransitionOrderStatus(from, to string) bool {
	from = NormalizeOrderStatus(from)
	to = NormalizeOrderStatus(to)
	if !IsValidOrderStatus(from) || !IsValidOrderStatus(to) {
		return false
	}
	if from == to {
		return true
	}
	next, ok := orderTransitions[from]
	if !ok {
		return false
	}
	_, ok = next[to]
	return ok
}

// OrderStatuses returns a copy of the known statuses for validation tests.
func OrderStatuses() []string {
	statuses := make([]string, 0, len(orderStatuses))
	for _, status := range []string{
		OrderStatusPending,
		OrderStatusProcessing,
		OrderStatusPaid,
		OrderStatusShipped,
		OrderStatusCompleted,
		OrderStatusCancelled,
	} {
		statuses = append(statuses, status)
	}
	return statuses
}
