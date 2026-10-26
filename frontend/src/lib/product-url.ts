import type { Product } from "@/lib/store";

export function productSlug(product: Pick<Product, "id" | "name">) {
  const name = product.name
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `${name || "san-pham"}-${product.id}`;
}

export function productHref(product: Pick<Product, "id" | "name">) {
  return `/products/${productSlug(product)}`;
}

export function productIdFromSlug(slug: string) {
  const id = Number(slug.match(/-(\d+)$/)?.[1] ?? slug);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
