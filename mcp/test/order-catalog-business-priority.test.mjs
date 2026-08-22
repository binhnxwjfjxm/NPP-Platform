import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sheet = await readFile(new URL("../src/features/orders/CoreOrderCreateSheet.tsx", import.meta.url), "utf8");
const priority = await readFile(new URL("../src/features/orders/order-catalog-priority.ts", import.meta.url), "utf8");

test("order category filter follows the locked business order", () => {
  const milkTeaIndex = priority.indexOf('"Trà sữa"');
  const spicyIndex = priority.indexOf('"Mì Cay"');
  const frozenIndex = priority.indexOf('"Đông Lạnh"');
  const snackIndex = priority.indexOf('"Ăn Vặt"');
  const packagingIndex = priority.indexOf('"Bao Bì"');

  assert.ok(milkTeaIndex > 0);
  assert.ok(spicyIndex > milkTeaIndex);
  assert.ok(frozenIndex > spicyIndex);
  assert.ok(snackIndex > frozenIndex);
  assert.ok(packagingIndex > snackIndex);
  assert.match(priority, /BUSINESS_CATEGORY_ORDER/);
  assert.match(priority, /label: "Nhóm bán hàng"/);
  assert.match(sheet, /const categorySections = useMemo\(\(\) => groupCatalogCategories\(categoryOptions\)/);
  assert.match(sheet, /categorySections\.map\(\(section\) => \(/);
  assert.match(sheet, /section\.categories\.map\(\(category\) => \(/);
  assert.doesNotMatch(sheet, /<select value=\{productCategory\}/);
});

test("catalog priority no longer derives business groups from Core UUID product ids", () => {
  assert.doesNotMatch(priority, /split\("-"\)\[0\]/);
  assert.doesNotMatch(priority, /prefix === "T"/);
  assert.doesNotMatch(priority, /prefix === "F"/);
  assert.doesNotMatch(priority, /prefix === "D"/);
  assert.doesNotMatch(priority, /prefix === "P"/);
  assert.match(priority, /productFamilyRank\(left\.category\)/);
  assert.match(sheet, /\.sort\(compareCatalogProducts\)/);
  assert.match(sheet, /catalogFamilyLabel\(group\.productId, group\.category\)/);
});

test("product choices keep the exact Công Ty variant while presenting flat selling-unit rows", () => {
  assert.match(sheet, /normalizeText\(rawVariant\) === "mac dinh" \? "" : rawVariant/);
  assert.match(sheet, /function purchaseUnitLabel\(item: ProductCatalogItem\)/);
  assert.match(sheet, /return "Thùng"/);
  assert.match(sheet, /return "Lẻ"/);
  assert.match(sheet, /group\.variants\.map\(\(product\) => \{/);
  assert.match(sheet, /onClick=\{\(\) => addProduct\(product\)\}/);
  assert.match(sheet, /variantId: item\.variantId/);
  assert.doesNotMatch(sheet, /styles\.variantButton|styles\.variantGrid/);
});
