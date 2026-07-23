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

type CategoryFamilyRule = {
  key: string;
  label: string;
  categories: string[];
};

const CATEGORY_FAMILIES: CategoryFamilyRule[] = [
  {
    key: "milk-tea",
    label: "Nguyên liệu trà sữa",
    categories: [
      "Trà",
      "Sữa",
      "Siro",
      "Bột",
      "Topping",
      "Đường & ngọt",
      "Sinh tố",
      "Trái cây / mứt",
      "Kem / Milk foam"
    ]
  },
  {
    key: "spicy-food",
    label: "Mì cay & đồ ăn",
    categories: ["Mì cay", "Đông lạnh", "Bánh tráng"]
  },
  {
    key: "packaging",
    label: "Bao bì & dụng cụ",
    categories: ["Bao bì"]
  },
  {
    key: "other",
    label: "Nhóm khác",
    categories: ["Phụ gia", "Đồ lẻ"]
  }
];

function normalizeCategory(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

const categoryPosition = new Map<string, { familyIndex: number; categoryIndex: number }>();
CATEGORY_FAMILIES.forEach((family, familyIndex) => {
  family.categories.forEach((category, categoryIndex) => {
    categoryPosition.set(normalizeCategory(category), { familyIndex, categoryIndex });
  });
});

function categoryOrder(value: unknown) {
  const known = categoryPosition.get(normalizeCategory(value));
  return known || { familyIndex: CATEGORY_FAMILIES.length, categoryIndex: Number.MAX_SAFE_INTEGER };
}

export function compareCatalogCategories(left: string, right: string) {
  const leftOrder = categoryOrder(left);
  const rightOrder = categoryOrder(right);
  if (leftOrder.familyIndex !== rightOrder.familyIndex) return leftOrder.familyIndex - rightOrder.familyIndex;
  if (leftOrder.categoryIndex !== rightOrder.categoryIndex) return leftOrder.categoryIndex - rightOrder.categoryIndex;
  return left.localeCompare(right, "vi");
}

export function groupCatalogCategories(categories: string[]): CatalogCategorySection[] {
  const uniqueCategories = Array.from(new Set(categories.map((category) => category.trim()).filter(Boolean)));
  const pending = new Set(uniqueCategories);
  const sections: CatalogCategorySection[] = [];

  CATEGORY_FAMILIES.forEach((family) => {
    const matched = family.categories.filter((expected) => {
      const actual = uniqueCategories.find((category) => normalizeCategory(category) === normalizeCategory(expected));
      if (!actual) return false;
      pending.delete(actual);
      return true;
    }).map((expected) => uniqueCategories.find((category) => normalizeCategory(category) === normalizeCategory(expected)) as string);

    if (matched.length) sections.push({ key: family.key, label: family.label, categories: matched });
  });

  const remaining = Array.from(pending).sort((left, right) => left.localeCompare(right, "vi"));
  if (remaining.length) sections.push({ key: "uncategorized", label: "Nhóm chưa xếp", categories: remaining });
  return sections;
}

function productFamilyRank(productId: string, category?: string | null) {
  const prefix = String(productId || "").trim().toUpperCase().split("-")[0];
  const normalizedCategory = normalizeCategory(category);
  if (prefix === "T") return 0;
  if (normalizedCategory === normalizeCategory("Mì cay")) return 1;
  if (prefix === "F") return 2;
  if (prefix === "D") return 3;
  if (prefix === "P") return 4;
  return 5;
}

export function compareCatalogProducts(left: CatalogProductIdentity, right: CatalogProductIdentity) {
  const familyDifference = productFamilyRank(left.productId, left.category) - productFamilyRank(right.productId, right.category);
  if (familyDifference) return familyDifference;

  const categoryDifference = compareCatalogCategories(String(left.category || ""), String(right.category || ""));
  if (categoryDifference) return categoryDifference;
  return left.name.localeCompare(right.name, "vi");
}

export function catalogFamilyLabel(productId: string, category?: string | null) {
  const rank = productFamilyRank(productId, category);
  if (rank === 0) return "Trà sữa";
  if (rank === 1) return "Mì cay";
  if (rank === 2) return "Đông lạnh";
  if (rank === 3) return "Đồ ăn / nguyên liệu";
  if (rank === 4) return "Bao bì";
  return "Nhóm khác";
}
