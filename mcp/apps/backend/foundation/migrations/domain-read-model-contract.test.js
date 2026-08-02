import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const canonical = readFileSync(
  new URL("../../../../../database/migrations/mcp/002_mcp_domain_read_models.sql", import.meta.url),
  "utf8"
);
const runtime = readFileSync(
  new URL("./sql/002_mcp_domain_read_models.sql", import.meta.url),
  "utf8"
);

test("canonical and runtime MCP domain migrations stay byte-identical", () => {
  assert.equal(runtime, canonical);
});

test("Core compatibility views use current production shared columns", () => {
  for (const fragment of [
    "c.code AS customer_code",
    "c.name AS legal_name",
    "c.name AS account_name",
    "c.responsible_employee_id::text AS sales_owner",
    "c.payment_terms_days",
    "p.code AS product_code",
    "p.brand_id::text AS brand_code",
    "p.category_id::text AS category",
    "v.name AS variant_name",
    "v.source_package_description",
    "v.source_unit_label",
    "v.conversion_to_base",
    "v.unit_source_metadata AS raw_options"
  ]) {
    assert.match(canonical, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const legacyColumn of [
    "c.customer_code",
    "c.legal_name",
    "c.trading_name",
    "c.sales_region",
    "c.address",
    "c.status",
    "c.sales_owner",
    "c.payment_term_days",
    "c.price_list_id",
    "p.product_code",
    "p.brand AS",
    "p.category,",
    "p.base_uom",
    "p.purchase_uom",
    "p.sales_uom",
    "v.variant_name",
    "v.size_label",
    "v.sell_unit",
    "v.pack_unit",
    "v.pack_quantity"
  ]) {
    assert.equal(canonical.includes(legacyColumn), false, `legacy Core column remains: ${legacyColumn}`);
  }
});

test("orders remain MCP-owned writable tables rather than Core views", () => {
  assert.match(canonical, /CREATE TABLE IF NOT EXISTS mcp\.orders/);
  assert.match(canonical, /CREATE TABLE IF NOT EXISTS mcp\.order_items/);
  assert.doesNotMatch(canonical, /CREATE OR REPLACE VIEW mcp\.(orders|order_items)/);
  assert.doesNotMatch(canonical, /FROM sales\./);
});
