import { afterEach, describe, expect, it, vi } from "vitest";
import { storeApi } from "./store";

describe("storeApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads products and uses bearer authentication for customer orders", async () => {
    const payload = { items: [] };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetch);

    await expect(storeApi.products()).resolves.toEqual(payload);
    await expect(storeApi.customerOrders("customer-jwt")).resolves.toEqual(payload);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/api/v1/products",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/api/v1/orders",
      expect.objectContaining({ headers: { Authorization: "Bearer customer-jwt" } }),
    );
  });

  it("sends product and checkout forms and loads admin reports", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetch);
    const product = {
      sku: "SKU-2",
      name: "Cup",
      description: "",
      imageUrl: "",
      priceVnd: 99000,
      stock: 4,
    };
    const order = {
      recipientName: "Buyer",
      phone: "0123456789",
      shippingAddress: "Street 1",
      items: [{ productId: 2, quantity: 1 }],
    };

    await storeApi.createProduct("admin-jwt", product);
    await storeApi.createOrder("customer-jwt", order);
    await storeApi.adminProducts("admin-jwt");
    await storeApi.adminOrders("admin-jwt");
    await storeApi.dashboard("admin-jwt");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/admin/products",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer admin-jwt" },
        body: JSON.stringify(product),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/orders",
      expect.objectContaining({ body: JSON.stringify(order) }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/admin/dashboard",
      expect.anything(),
    );
  });

  it("reports API errors and handles a response without JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "Out of stock" }),
      }),
    );
    await expect(storeApi.products()).rejects.toThrow("Out of stock (409)");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("bad json");
        },
      }),
    );
    await expect(storeApi.products()).rejects.toThrow("Request failed (502)");
  });

  it("loads, saves, and clears the server-side cart", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal("fetch", fetch);
    const cartId = "9d77cd79-d774-45d0-a960-566b94069386";
    const items = [{ productId: 4, quantity: 2 }];

    await storeApi.getCart(cartId);
    await storeApi.saveCart(cartId, items);
    await storeApi.clearCart(cartId);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      `http://localhost:8080/api/v1/cart/${cartId}`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `http://localhost:8080/api/v1/cart/${cartId}`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ items }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      `http://localhost:8080/api/v1/cart/${cartId}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("contact submissions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts contact details with the Google Maps location", async () => {
    const payload = { id: 7, name: "An", phone: "0901234567", address: "Quận 1" };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetch);
    const contact = {
      name: "An",
      phone: "0901234567",
      address: "Quận 1",
      mapLocation: "https://maps.google.com/?q=10.7769,106.7009",
    };

    await expect(storeApi.createContact(contact)).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/contacts",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contact),
      }),
    );
  });

  it("lists and deletes contacts with admin authentication", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal("fetch", fetch);

    await storeApi.adminContacts("admin-jwt");
    await storeApi.deleteContact("admin-jwt", 7);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/api/v1/admin/contacts",
      expect.objectContaining({ headers: { Authorization: "Bearer admin-jwt" } }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/api/v1/admin/contacts/7",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer admin-jwt" },
      }),
    );
  });
});
