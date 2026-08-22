export type CatalogCategorySection = {
  key: string;
  label: string;
  categories: string[];
};

type CatalogProductIdentity = {
  productId: string;
  name: string;
  category?: string | null;
};

export const BUSINESS_CATEGORY_ORDER = [
  "Trà sữa",
  "Mì Cay",
  "Đông Lạnh",
  "Ăn Vặt",
  "Bao Bì"
] as const;

function normalizeCategory(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

const categoryRank = new Map<string, number>(
  BUSINESS_CATEGORY_ORDER.map((category, index) => [normalizeCategory(category), index] as const)
);

function categoryOrder(value: unknown) {
  return categoryRank.get(normalizeCategory(value)) ?? BUSINESS_CATEGORY_ORDER.length;
}

export function compareCatalogCategories(left: string, right: string) {
  const rankDifference = categoryOrder(left) - categoryOrder(right);
  return rankDifference || left.localeCompare(right, "vi");
}

export function groupCatalogCategories(categories: string[]): CatalogCategorySection[] {
  const uniqueCategories = Array.from(new Set(categories.map((category) => category.trim()).filter(Boolean)));
  const known = BUSINESS_CATEGORY_ORDER
    .map((expected) => uniqueCategories.find((category) => normalizeCategory(category) === normalizeCategory(expected)))
    .filter((category): category is string => Boolean(category));
  const knownKeys = new Set(known.map(normalizeCategory));
  const remaining = uniqueCategories
    .filter((category) => !knownKeys.has(normalizeCategory(category)))
    .sort((left, right) => left.localeCompare(right, "vi"));
  const sections: CatalogCategorySection[] = [];
  if (known.length) sections.push({ key: "business", label: "Nhóm bán hàng", categories: known });
  if (remaining.length) sections.push({ key: "uncategorized", label: "Nhóm chưa xếp", categories: remaining });
  return sections;
}

function productFamilyRank(category?: string | null) {
  return categoryOrder(category);
}

export function compareCatalogProducts(left: CatalogProductIdentity, right: CatalogProductIdentity) {
  const familyDifference = productFamilyRank(left.category) - productFamilyRank(right.category);
  if (familyDifference) return familyDifference;

  const categoryDifference = compareCatalogCategories(String(left.category || ""), String(right.category || ""));
  if (categoryDifference) return categoryDifference;
  return left.name.localeCompare(right.name, "vi");
}

export function catalogFamilyLabel(_productId: string, category?: string | null) {
  return categoryRank.has(normalizeCategory(category)) ? "" : "Nhóm khác";
}
