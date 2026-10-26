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
  stock: number;
  isActive: boolean;
  categories: Category[];
};

export type Category = { id: number; name: string; slug: string; description: string };

export type Order = {
  id: number;
  orderNumber: string;
  customerName?: string;
  totalVnd: number;
  status: string;
  recipientName: string;
  phone: string;
  shippingAddress: string;
  createdAt: string;
  items: { productId: number; productName: string; quantity: number; unitPriceVnd: number }[];
};

export type CartItem = { productId: number; quantity: number };

export type ContactInput = {
  name: string;
  phone: string;
  address: string;
  mapLocation: string;
};

export type Contact = ContactInput & { id: number; createdAt: string };

export type DashboardStats = {
  productCount: number;
  orderCount: number;
  pendingOrders: number;
  revenueVnd: number;
};

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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${payload.error ?? "Request failed"} (${response.status})`);
  return payload as T;
}

export const storeApi = {
  categories: () => request<{ items: Category[] }>("/api/v1/categories"),
  createCategory: (token: string, category: Omit<Category, "id">) =>
    request<Category>("/api/v1/admin/categories", token, {
      method: "POST",
      body: JSON.stringify(category),
    }),
  updateCategory: (token: string, id: number, category: Omit<Category, "id">) =>
    request<Category>(`/api/v1/admin/categories/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(category),
    }),
  deleteCategory: (token: string, id: number) =>
    request<void>(`/api/v1/admin/categories/${id}`, token, { method: "DELETE" }),
  products: () => request<{ items: Product[] }>("/api/v1/products"),
  product: (productId: number) => request<Product>(`/api/v1/products/${productId}`),
  getCart: (cartId: string) => request<{ items: CartItem[] }>(`/api/v1/cart/${cartId}`),
  saveCart: (cartId: string, items: CartItem[]) =>
    request<{ items: CartItem[] }>(`/api/v1/cart/${cartId}`, undefined, {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
  clearCart: (cartId: string) =>
    request<void>(`/api/v1/cart/${cartId}`, undefined, { method: "DELETE" }),
  adminProducts: (token: string) => request<{ items: Product[] }>("/api/v1/admin/products", token),
  createProduct: (
    token: string,
    product: Omit<Product, "id" | "isActive" | "categories" | "images"> & {
      categoryIds: number[];
      imageUrls?: string[];
    },
  ) =>
    request<Product>("/api/v1/admin/products", token, {
      method: "POST",
      body: JSON.stringify(product),
    }),
  updateProduct: (
    token: string,
    id: number,
    product: Omit<Product, "id" | "isActive" | "categories" | "images"> & {
      categoryIds: number[];
      imageUrls?: string[];
    },
  ) =>
    request<Product>(`/api/v1/admin/products/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(product),
    }),
  deleteProduct: (token: string, id: number) =>
    request<void>(`/api/v1/admin/products/${id}`, token, { method: "DELETE" }),
  uploadProductImages: async (token: string, files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("images", file));
    const result = await request<{ items: string[] }>("/api/v1/admin/product-images", token, {
      method: "POST",
      body: formData,
    });
    return result.items.map((path) => (path.startsWith("http") ? path : `${apiURL}${path}`));
  },
  createOrder: (
    token: string,
    order: {
      recipientName: string;
      phone: string;
      shippingAddress: string;
      items: { productId: number; quantity: number }[];
    },
  ) => request<Order>("/api/v1/orders", token, { method: "POST", body: JSON.stringify(order) }),
  customerOrders: (token: string) => request<{ items: Order[] }>("/api/v1/orders", token),
  adminOrders: (token: string) => request<{ items: Order[] }>("/api/v1/admin/orders", token),
  dashboard: (token: string) => request<DashboardStats>("/api/v1/admin/dashboard", token),
  createContact: (contact: ContactInput) =>
    request<Contact>("/api/v1/contacts", undefined, {
      method: "POST",
      body: JSON.stringify(contact),
    }),
  adminContacts: (token: string) => request<{ items: Contact[] }>("/api/v1/admin/contacts", token),
  deleteContact: (token: string, id: number) =>
    request<void>(`/api/v1/admin/contacts/${id}`, token, { method: "DELETE" }),
};
