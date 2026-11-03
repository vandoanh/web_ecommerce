import { clearAccessToken, getAccessToken } from "@/lib/storage";

const apiURL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type Product = {
  id: number;
  sku: string;
  name: string;
  description: string;
  imageUrl: string;
  images?: string[];
  priceVnd: number;
  regularPriceVnd: number;
  discountPriceVnd: number | null;
  discountStartsAt: string | null;
  discountEndsAt: string | null;
  priceEffectiveAt: string;
  stock: number;
  stockVersion: number;
  isActive: boolean;
  categories: Category[];
};
export type Category = { id: number; name: string; slug: string; description: string };
export type CategoryInput = Omit<Category, "id">;
export type ProductWriteInput = {
  name: string;
  description: string;
  imageUrl: string;
  imageUrls?: string[];
  regularPriceVnd: number;
  discountPriceVnd?: number | null;
  discountStartsAt?: string | null;
  discountEndsAt?: string | null;
  isActive?: boolean;
  categoryIds: number[];
};
export type ProductCreateInput = ProductWriteInput & { stock: number };
export type ProductUpdateInput = ProductWriteInput & { sku: string };
export type StockAdjustmentInput = {
  delta: number;
  reason: string;
  idempotencyKey?: string;
};
export type StockAdjustmentResult = {
  productId: number;
  stock: number;
  stockVersion: number;
};
export type DeliverySettings = {
  phone: string;
  address: string;
  mapLocation: string;
  deliveryText: string;
  updatedAt: string;
  version: number;
};
export type DeliverySettingsInput = Omit<DeliverySettings, "updatedAt" | "version"> & {
  expectedVersion: number;
};
export type OrderStatus = "pending" | "processing" | "paid" | "shipped" | "completed" | "cancelled";
export type OrderItem = {
  productId: number;
  productName: string;
  quantity: number;
  unitPriceVnd: number;
};
export type Order = {
  id: number;
  orderNumber: string;
  userId?: number;
  customerName?: string;
  totalVnd: number;
  status: OrderStatus | string;
  paymentMethod?: string;
  recipientName: string;
  phone: string;
  shippingAddress: string;
  createdAt: string;
  items: OrderItem[];
};
export type OrderPage = { items: Order[]; page: number; pageSize: number; total: number };
export type AdminOrderFilters = { status?: string; q?: string };
export type OrderQuery = { page?: number; pageSize?: number; status?: string; q?: string };
export type CreateOrderPayload = {
  recipientName: string;
  phone: string;
  shippingAddress: string;
  items: { productId: number; quantity: number }[];
};
export type CartItem = { productId: number; quantity: number };
export type ContactInput = { name: string; phone: string; address: string; mapLocation: string };
export type Contact = ContactInput & { id: number; createdAt: string };
export type DashboardStats = {
  productCount: number;
  orderCount: number;
  pendingOrders: number;
  revenueVnd: number;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function normalizeOrderPage(
  payload: Partial<OrderPage> | undefined,
  page: number,
  pageSize: number,
): OrderPage {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return {
    items,
    page: typeof payload?.page === "number" ? payload.page : page,
    pageSize: typeof payload?.pageSize === "number" ? payload.pageSize : pageSize,
    total: typeof payload?.total === "number" ? payload.total : items.length,
  };
}

function orderQueryString(query: OrderQuery = {}) {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.status) params.set("status", query.status);
  if (query.q) params.set("q", query.q);
  const value = params.toString();
  return value ? `?${value}` : "";
}

async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiURL}${path}`, {
    ...init,
    headers: {
      ...(init.body && !(typeof FormData !== "undefined" && init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  if (
    response.status === 401 &&
    token &&
    path.startsWith("/api/v1/admin/") &&
    typeof window !== "undefined" &&
    getAccessToken("admin-token") === token
  ) {
    clearAccessToken("admin-token");
    window.dispatchEvent(new Event("store-auth-change"));
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(
      payload.error ?? `Request failed (${response.status})`,
      response.status,
      payload.code,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const storeApi = {
  products: () => request<{ items: Product[] }>("/api/v1/products"),
  categories: () => request<{ items: Category[] }>("/api/v1/categories"),
  product: (id: number | string) => request<Product>(`/api/v1/products/${id}`),
  getCart: (cartId: string) => request<{ items: CartItem[] }>(`/api/v1/cart/${cartId}`),
  cart: (cartId: string) => request<{ items: CartItem[] }>(`/api/v1/cart/${cartId}`),
  saveCart: (cartId: string, items: CartItem[]) =>
    request<{ items: CartItem[] }>(`/api/v1/cart/${cartId}`, undefined, {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
  clearCart: (cartId: string) =>
    request<void>(`/api/v1/cart/${cartId}`, undefined, { method: "DELETE" }),
  createOrder: (token: string, order: CreateOrderPayload, idempotencyKey: string) =>
    request<Order>("/api/v1/orders", token, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(order),
    }),
  customerOrders: async (token: string, pageOrQuery: number | OrderQuery = 1, pageSize = 20) => {
    const query: OrderQuery =
      typeof pageOrQuery === "number" ? { page: pageOrQuery, pageSize } : pageOrQuery;
    return normalizeOrderPage(
      await request<Partial<OrderPage>>(`/api/v1/orders${orderQueryString(query)}`, token),
      query.page ?? 1,
      query.pageSize ?? 20,
    );
  },
  customerOrder: (token: string, id: number) => request<Order>(`/api/v1/orders/${id}`, token),
  cancelOrder: (token: string, id: number) =>
    request<Order>(`/api/v1/orders/${id}/cancel`, token, { method: "POST" }),
  customerCancelOrder: (token: string, id: number) =>
    request<Order>(`/api/v1/orders/${id}/cancel`, token, { method: "POST" }),
  adminOrders: async (
    token: string,
    pageOrQuery: number | OrderQuery = 1,
    pageSize = 20,
    filters: AdminOrderFilters = {},
  ) => {
    const query: OrderQuery =
      typeof pageOrQuery === "number" ? { page: pageOrQuery, pageSize, ...filters } : pageOrQuery;
    return normalizeOrderPage(
      await request<Partial<OrderPage>>(`/api/v1/admin/orders${orderQueryString(query)}`, token),
      query.page ?? 1,
      query.pageSize ?? 20,
    );
  },
  adminOrder: (token: string, id: number) => request<Order>(`/api/v1/admin/orders/${id}`, token),
  updateOrderStatus: (token: string, id: number, status: string) =>
    request<Order>(`/api/v1/admin/orders/${id}/status`, token, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  adminUpdateOrderStatus: (token: string, id: number, status: string) =>
    request<Order>(`/api/v1/admin/orders/${id}/status`, token, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  dashboard: (token: string) => request<DashboardStats>("/api/v1/admin/dashboard", token),
  adminProducts: (token: string) => request<{ items: Product[] }>("/api/v1/admin/products", token),
  createCategory: (token: string, category: CategoryInput) =>
    request<Category>("/api/v1/admin/categories", token, {
      method: "POST",
      body: JSON.stringify(category),
    }),
  updateCategory: (token: string, id: number, category: CategoryInput) =>
    request<Category>(`/api/v1/admin/categories/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(category),
    }),
  deleteCategory: (token: string, id: number) =>
    request<void>(`/api/v1/admin/categories/${id}`, token, { method: "DELETE" }),
  createProduct: (token: string, product: ProductCreateInput) =>
    request<Product>("/api/v1/admin/products", token, {
      method: "POST",
      body: JSON.stringify(product),
    }),
  updateProduct: (token: string, id: number, product: ProductUpdateInput) =>
    request<Product>(`/api/v1/admin/products/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(product),
    }),
  deleteProduct: (token: string, id: number) =>
    request<void>(`/api/v1/admin/products/${id}`, token, { method: "DELETE" }),
  adjustProductStock: (token: string, id: number, adjustment: StockAdjustmentInput) =>
    request<StockAdjustmentResult>(`/api/v1/admin/products/${id}/stock-adjustments`, token, {
      method: "POST",
      body: JSON.stringify(adjustment),
    }),
  adminDeliverySettings: (token: string) =>
    request<DeliverySettings>("/api/v1/admin/settings/delivery", token),
  updateDeliverySettings: (token: string, settings: DeliverySettingsInput) =>
    request<DeliverySettings>("/api/v1/admin/settings/delivery", token, {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  uploadProductImages: async (token: string, files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("images", file));
    const result = await request<{ items: string[] }>("/api/v1/admin/product-images", token, {
      method: "POST",
      body: formData,
    });
    return result.items.map((path) => (path.startsWith("http") ? path : `${apiURL}${path}`));
  },
  createContact: (contact: ContactInput) =>
    request<Contact>("/api/v1/contacts", undefined, {
      method: "POST",
      body: JSON.stringify(contact),
    }),
  adminContacts: (token: string) => request<{ items: Contact[] }>("/api/v1/admin/contacts", token),
  clearAccessToken,
  deleteContact: (token: string, id: number) =>
    request<void>(`/api/v1/admin/contacts/${id}`, token, { method: "DELETE" }),
};

export { getAccessToken };
