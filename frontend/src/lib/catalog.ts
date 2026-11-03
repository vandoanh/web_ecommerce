import type { Category } from "@/lib/store";

export const requestedFoodGroups = [
  { id: "banh-mi", name: "Bánh mì", matches: ["banh-mi", "bánh mì", "banh mi"] },
  { id: "pate", name: "Pâté", matches: ["pate", "pâté", "pa-te", "pa-tê"] },
  { id: "sauces", name: "Sauces", matches: ["sauces", "sauce", "sot", "sốt"] },
  { id: "gio-lua", name: "Giò lụa", matches: ["gio-lua", "giò lụa", "gio lua"] },
  { id: "gio-tai", name: "Giò tai", matches: ["gio-tai", "giò tai", "gio tai"] },
  {
    id: "thit-nguoi",
    name: "Thịt nguội",
    matches: ["thit-nguoi", "thịt nguội", "thit nguoi", "cold-cuts", "cold cuts"],
  },
] as const;

export function categorySlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function matchingFoodGroup(category: Pick<Category, "name" | "slug">) {
  const keys = [categorySlug(category.slug), categorySlug(category.name)];
  return requestedFoodGroups.find(
    (group) =>
      group.matches.some((match) => keys.includes(categorySlug(match))) || keys.includes(group.id),
  );
}

export function categoryTabs(categories: Category[]) {
  // Only show API-backed categories and aggregate tabs for groups represented
  // by multiple categories. A single category already has its own tab.
  const groupCounts = new Map<string, number>();
  for (const category of categories) {
    const group = matchingFoodGroup(category);
    if (group) groupCounts.set(group.id, (groupCounts.get(group.id) ?? 0) + 1);
  }
  const groups = new Set([...groupCounts].filter(([, count]) => count > 1).map(([id]) => id));
  const canonicalNames = new Set(
    requestedFoodGroups
      .filter((group) => groups.has(group.id))
      .map((group) => categorySlug(group.name)),
  );
  return [
    { id: null, name: "Tất cả" },
    ...categories
      .filter((category) => {
        const group = matchingFoodGroup(category);
        return !group || !groups.has(group.id) || !canonicalNames.has(categorySlug(category.name));
      })
      .map((category) => ({ id: String(category.id), name: category.name })),
    ...requestedFoodGroups
      .filter(
        (group) =>
          groups.has(group.id) &&
          !categories.some((category) => categorySlug(category.name) === categorySlug(group.name)),
      )
      .map((group) => ({ id: `group:${group.id}`, name: group.name })),
  ];
}

export function foodGroupMatchesCategory(
  groupId: string,
  category: Pick<Category, "name" | "slug">,
) {
  return matchingFoodGroup(category)?.id === groupId;
}
