import { describe, expect, it } from "vitest";
import { foodPlaceholder, imageFallback } from "@/lib/image-fallback";

describe("broken image fallback", () => {
  it("replaces a broken source with the food illustration", () => {
    expect(imageFallback("https://example.invalid/product.jpg")).toBe(foodPlaceholder);
  });

  it("does not repeatedly fall back if the illustration itself fails", () => {
    expect(imageFallback(foodPlaceholder)).toBeNull();
  });
});
