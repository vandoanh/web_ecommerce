import { describe, expect, it } from "vitest";
import { categoryTabs, foodGroupMatchesCategory } from "@/lib/catalog";
import type { Category } from "@/lib/store";

const category = (id: number, name: string, slug: string): Category => ({
  id,
  name,
  slug,
  description: "",
});

describe("storefront category tabs", () => {
  it("shows backend categories, avoids duplicate canonical labels, and adds aggregates only for aliases", () => {
    const categories = [
      category(1, "Bánh mì", "banh-mi"),
      category(2, "Seasonal specials", "seasonal-specials"),
      category(3, "Pâté", "pate"),
    ];

    expect(categoryTabs(categories)).toEqual([
      { id: null, name: "Tất cả" },
      { id: "1", name: "Bánh mì" },
      { id: "2", name: "Seasonal specials" },
      { id: "3", name: "Pâté" },
    ]);
    expect(categoryTabs([])).toEqual([{ id: null, name: "Tất cả" }]);
  });

  it("adds aggregate tabs only for represented groups and avoids duplicate labels", () => {
    const tabs = categoryTabs([
      category(1, "Bánh mì", "banh-mi"),
      category(2, "Baguettes", "banh-mi-que"),
      category(3, "Sauce spicy", "sauce-spicy"),
      category(4, "Sauce sweet", "sauce-sweet"),
    ]);
    expect(tabs).toEqual([
      { id: null, name: "Tất cả" },
      { id: "1", name: "Bánh mì" },
      { id: "2", name: "Baguettes" },
      { id: "3", name: "Sauce spicy" },
      { id: "4", name: "Sauce sweet" },
    ]);
  });

  it("matches requested categories using slug or normalized name without matching arbitrary categories", () => {
    expect(foodGroupMatchesCategory("banh-mi", category(1, "Breads", "bánh-mì"))).toBe(true);
    expect(foodGroupMatchesCategory("gio-lua", category(2, "GIO LUA", "gio-lua"))).toBe(true);
    expect(foodGroupMatchesCategory("pate", category(3, "Seasonal Pâté special", "seasonal"))).toBe(
      false,
    );
    expect(foodGroupMatchesCategory("pate", category(4, "Seasonal", "seasonal"))).toBe(false);
  });
});
