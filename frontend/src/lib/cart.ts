import { storeApi, type CartItem } from "@/lib/store";

export async function loadStoreCart(): Promise<{ cartId: string; items: CartItem[] }> {
  const cartId = localStorage.getItem("store-cart-id") || crypto.randomUUID();
  localStorage.setItem("store-cart-id", cartId);

  let legacy: Record<string, unknown> = {};
  try {
    const previous = localStorage.getItem("store-cart");
    if (previous) legacy = JSON.parse(previous) as Record<string, unknown>;
  } catch {
    localStorage.removeItem("store-cart");
  }

  let saved = await storeApi.getCart(cartId);
  if (saved.items.length === 0 && Object.keys(legacy).length > 0) {
    const imported = Object.entries(legacy)
      .map(([productId, quantity]) => ({ productId: Number(productId), quantity }))
      .filter(
        (item): item is CartItem =>
          Number.isInteger(item.productId) &&
          item.productId > 0 &&
          typeof item.quantity === "number" &&
          Number.isInteger(item.quantity) &&
          item.quantity > 0 &&
          item.quantity <= 99,
      )
      .slice(0, 100);
    saved = await storeApi.saveCart(cartId, imported);
  }
  localStorage.removeItem("store-cart");
  return { cartId, items: saved.items };
}
