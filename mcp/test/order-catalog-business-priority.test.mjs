import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sheet = await readFile(new URL("../src/features/orders/OrderCreateSheet.tsx", import.meta.url), "utf8");
const priority = await readFile(new URL("../src/features/orders/order-catalog-priority.ts", import.meta.url), "utf8");

test("order category filter follows distributor business priority instead of alphabetic order", () => {
  const milkTeaIndex = priority.indexOf('label: "Nguyên liệu trà sữa"');
  const spicyIndex = priority.indexOf('label: "Mì cay & đồ ăn"');
  const packagingIndex = priority.indexOf('label: "Bao bì & dụng cụ"');

  assert.ok(milkTeaIndex > 0);
  assert.ok(spicyIndex > milkTeaIndex);
  assert.ok(packagingIndex > spicyIndex);
  assert.match(priority, /categories: \[\s*"Trà",\s*"Sữa",\s*"Siro",\s*"Bột",\s*"Topping"/);
  assert.match(priority, /categories: \["Mì cay", "Đông lạnh", "Bánh tráng"\]/);
  assert.match(sheet, /const categorySections = useMemo\(\(\) => groupCatalogCategories\(categoryOptions\)/);
  assert.match(sheet, /categorySections\.map\(\(section\) => \(/);
  assert.match(sheet, /<optgroup key=\{section\.key\} label=\{section\.label\}>/);
  assert.doesNotMatch(sheet, /categoryOptions\.map\(\(category\)/);
});

test("catalog cards sort tea-milk products first and spicy-noodle products next", () => {
  assert.match(priority, /if \(prefix === "T"\) return 0/);
  assert.match(priority, /if \(normalizedCategory === normalizeCategory\("Mì cay"\)\) return 1/);
  assert.match(priority, /if \(prefix === "F"\) return 2/);
  assert.match(priority, /if \(prefix === "D"\) return 3/);
  assert.match(priority, /if \(prefix === "P"\) return 4/);
  assert.match(sheet, /\.sort\(compareCatalogProducts\)/);
  assert.match(sheet, /catalogFamilyLabel\(group\.productId, group\.category\)/);
  assert.match(sheet, /data-family=\{family\}/);
});

test("product choices replace meaningless default labels with selling-unit context", () => {
  assert.match(sheet, /normalizeText\(rawVariant\) === "mac dinh" \? "" : rawVariant/);
  assert.match(sheet, /return variant \|\| size \|\| item\.sellUnit \|\| item\.sku \|\| "Quy cách chuẩn"/);
  assert.match(sheet, /"Chạm để thêm vào đơn"/);
  assert.match(sheet, /const choiceCount = group\.variants\.length > 1 \? `\$\{group\.variants\.length\} vị \/ quy cách` : "1 quy cách"/);
  assert.match(sheet, /title=\{`\$\{product\.name\} · \$\{primaryLabel\} · \$\{secondaryLabel\}`\}/);
});
