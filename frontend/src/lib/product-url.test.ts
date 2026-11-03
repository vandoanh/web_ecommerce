import { describe, expect, it } from "vitest";
import { productHref, productIdFromSlug, productSlug } from "./product-url";

describe("product URLs", () => {
  it("builds Vietnamese-friendly slugs with the product id", () => {
    expect(productSlug({ id: 12, name: "Giò lụa Đặc Biệt" })).toBe("gio-lua-dac-biet-12");
    expect(productHref({ id: 7, name: "Pa-tê" })).toBe("/products/pa-te-7");
  });

  it("falls back for names containing no slug characters", () => {
    expect(productSlug({ id: 3, name: "!!!" })).toBe("san-pham-3");
  });

  it("parses valid ids from slugs only", () => {
    expect(productIdFromSlug("gio-lua-12")).toBe(12);
    expect(productIdFromSlug("12")).toBe(12);
    expect(productIdFromSlug("gio-lua")).toBeNull();
    expect(productIdFromSlug("gio-lua-0")).toBeNull();
    expect(productIdFromSlug("gio-lua-1.5")).toBeNull();
  });
});
