import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadStoreCart } from "./cart";
import { storeApi } from "@/lib/store";

vi.mock("@/lib/store", () => ({
  storeApi: {
    getCart: vi.fn(),
    saveCart: vi.fn(),
  },
}));

const mockedApi = vi.mocked(storeApi);

describe("loadStoreCart", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("reuses a saved cart id and imports a valid legacy cart", async () => {
    const cartId = "9d77cd79-d774-45d0-a960-566b94069386";
    localStorage.setItem("store-cart-id", cartId);
    localStorage.setItem(
      "store-cart",
      JSON.stringify({ 2: 3, 1: 1, 5: "bad", 6: 0, 7: 1.5, 8: 120 }),
    );
    mockedApi.getCart.mockResolvedValue({ items: [] });
    mockedApi.saveCart.mockResolvedValue({
      items: [
        { productId: 2, quantity: 3 },
        { productId: 1, quantity: 1 },
      ],
    });

    await expect(loadStoreCart()).resolves.toEqual({
      cartId,
      items: [
        { productId: 2, quantity: 3 },
        { productId: 1, quantity: 1 },
      ],
    });
    expect(mockedApi.getCart).toHaveBeenCalledWith(cartId);
    expect(mockedApi.saveCart).toHaveBeenCalledWith(cartId, [
      { productId: 1, quantity: 1 },
      { productId: 2, quantity: 3 },
    ]);
    expect(localStorage.getItem("store-cart")).toBeNull();
  });

  it("keeps an existing server cart and discards corrupt legacy data", async () => {
    const cartId = "11111111-1111-4111-8111-111111111111";
    localStorage.setItem("store-cart-id", cartId);
    localStorage.setItem("store-cart", "not-json");
    mockedApi.getCart.mockResolvedValue({ items: [{ productId: 4, quantity: 2 }] });

    await expect(loadStoreCart()).resolves.toEqual({
      cartId,
      items: [{ productId: 4, quantity: 2 }],
    });
    expect(mockedApi.saveCart).not.toHaveBeenCalled();
    expect(localStorage.getItem("store-cart")).toBeNull();
  });
});
