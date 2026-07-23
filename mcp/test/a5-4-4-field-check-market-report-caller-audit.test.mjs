import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const transitional = await readFile(new URL("../apps/backend/foundation/transitional-api.js", import.meta.url), "utf8");
const fieldOwner = await readFile(new URL("../apps/backend/foundation/field-check-mutations.js", import.meta.url), "utf8");
const client = await readFile(new URL("../src/features/market-checks/MarketChecksClientPage.tsx", import.meta.url), "utf8");
const loader = await readFile(new URL("../src/features/market-checks/MarketChecksPage.tsx", import.meta.url), "utf8");

async function missing(path) {
  try {
    await access(new URL(path, import.meta.url));
    return false;
  } catch {
    return true;
  }
}

test("field-check route has one typed RPC owner and no direct table fallback", () => {
  assert.match(transitional, /updateFieldCheckResult/);
  assert.doesNotMatch(transitional, /test_customer_results\?id=/);
  assert.doesNotMatch(transitional, /test_customer_results\?select=/);
  assert.match(fieldOwner, /mcp_idempotent_update_field_check_result/);
  assert.doesNotMatch(fieldOwner, /supabaseRest\(|test_customer_results\?/);
  assert.match(fieldOwner, /result_id_required/);
});

test("dead duplicate market-report route and handler are retired", async () => {
  assert.equal(await missing("../src/app/api/mcp-market-reports/route.ts"), true);
  assert.doesNotMatch(transitional, /\/api\/mcp-market-reports/);
  assert.doesNotMatch(transitional, /saveMarketReport/);
  assert.doesNotMatch(transitional, /mcp_market_report_api/);
});

test("field-check UI cannot create missing result rows", () => {
  assert.match(client, /resultId: string;/);
  assert.match(client, /disabled=\{saving \|\| !check\?\.resultId\}/);
  assert.match(client, /Chưa có kết quả để cập nhật/);
});

test("read mapping covers the persisted status vocabulary", () => {
  assert.match(loader, /\["ok", "interested", "sample"/);
  assert.match(loader, /\["bad", "retry", "follow"/);
});
