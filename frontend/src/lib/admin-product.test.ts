import { describe, expect, it } from "vitest";
import {
  createProductInputFromForm,
  emptyProductForm,
  ProductFormError,
  productFormFromProduct,
  updateProductInputFromForm,
} from "./admin-product";
import type { Product } from "./store";

const product: Product = {
  id: 5,
  sku: "TKAB12CD34EF",
  name: "Bánh mì",
  description: "<p>Mô tả</p>",
  imageUrl: "/uploads/bread.jpg",
  images: ["/uploads/bread.jpg"],
  priceVnd: 45000,
  regularPriceVnd: 50000,
  discountPriceVnd: 45000,
  discountStartsAt: "2026-11-02T17:00:00Z",
  discountEndsAt: "2026-11-09T17:00:00Z",
  priceEffectiveAt: "2026-11-03T03:00:00Z",
  stock: 12,
  stockVersion: 4,
  isActive: true,
  categories: [{ id: 1, name: "Bánh mì", slug: "banh-mi", description: "" }],
};

const form = {
  ...emptyProductForm,
  sku: "TKAB12CD34EF",
  name: "Bánh mì",
  regularPriceVnd: "50000",
  discountPriceVnd: "45000",
  discountStartsAt: "2026-11-03T00:00",
  discountEndsAt: "2026-11-10T00:00",
  stock: "12",
  categoryIds: [1],
};

describe("admin product write payloads", () => {
  it("creates a product without a client SKU and with initial stock", () => {
    const input = createProductInputFromForm(form);
    expect("sku" in input).toBe(false);
    expect(input).toMatchObject({
      name: "Bánh mì",
      regularPriceVnd: 50000,
      stock: 12,
      categoryIds: [1],
      isActive: true,
      discountPriceVnd: 45000,
      discountStartsAt: "2026-11-03T00:00:00+07:00",
      discountEndsAt: "2026-11-10T00:00:00+07:00",
    });
  });

  it("updates the SKU but never sends stock", () => {
    const input = updateProductInputFromForm(form, { currentSKU: "OLD-SKU" });
    expect(input.sku).toBe("TKAB12CD34EF");
    expect("stock" in input).toBe(false);
  });

  it("allows the existing SKU to be kept unchanged", () => {
    expect(() =>
      updateProductInputFromForm({ ...form, sku: "LEGACY-SKU" }, { currentSKU: "LEGACY-SKU" }),
    ).not.toThrow();
  });

  it("rejects an invalid new SKU", () => {
    expect(() =>
      updateProductInputFromForm({ ...form, sku: "lowercase" }, { currentSKU: "OLD-SKU" }),
    ).toThrow(ProductFormError);
  });

  it("hydrates the edit form from API product data", () => {
    expect(productFormFromProduct(product)).toMatchObject({
      sku: "TKAB12CD34EF",
      regularPriceVnd: "50000",
      discountPriceVnd: "45000",
      discountStartsAt: "2026-11-03T00:00",
      discountEndsAt: "2026-11-10T00:00",
      stock: "12",
      categoryIds: [1],
    });
  });

  it("replaces an empty rich text value with an empty description", () => {
    const input = createProductInputFromForm({ ...form, description: "<p></p>" });
    expect(input.description).toBe("");
  });

  it("rejects invalid price and stock values", () => {
    expect(() => createProductInputFromForm({ ...form, regularPriceVnd: "0" })).toThrow(
      ProductFormError,
    );
    expect(() => createProductInputFromForm({ ...form, stock: "-1" })).toThrow(ProductFormError);
  });
});
