import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("E5 maps MCP source to the canonical active MCP sales channel before generic default", () => {
  const entry = read("../npp-core/api/src/services/sales-order-entry.js");
  assert.match(entry, /SOURCE_CHANNEL_CODE_BY_TYPE = Object\.freeze\(\{ MCP: 'MCP' \}\)/);
  assert.match(entry, /sourceChannelCode\(normalized\.payload\)/);
  assert.match(entry, /commercialRepository\.listActiveSalesChannels/);
  assert.match(entry, /String\(channel\.code \?\? ''\)\.trim\(\)\.toUpperCase\(\) === canonicalSourceChannelCode/);
  const sourceIndex = entry.indexOf("const canonicalSourceChannelCode = sourceChannelCode(normalized.payload)");
  const defaultIndex = entry.indexOf("commercialRepository.getDefaultSalesChannelId", sourceIndex);
  assert.ok(sourceIndex >= 0 && defaultIndex > sourceIndex, "MCP source channel must resolve before generic default");
  assert.match(entry, /Chưa cấu hình kênh bán hàng \$\{canonicalSourceChannelCode\} đang hoạt động/);
});

test("E5 official order now uses the direct MCP order workspace and never returns through order-intent", () => {
  const directService = read("apps/backend/foundation/direct-sales-orders.js");
  const ordersUi = read("src/features/orders/McpCoreOrdersClient.tsx");
  const legacyPage = read("src/app/visits/order-intent/page.tsx");
  assert.match(directService, /sourceType: "MCP"/);
  assert.match(directService, /sourceId: idempotencyKey/);
  assert.match(ordersUi, /\/api\/backend\/core-sales\/orders/);
  assert.match(ordersUi, /createIdempotencyKey\("mcp\.sales-order\.create"\)/);
  assert.doesNotMatch(ordersUi, /salesChannelId|Hãy chọn kênh bán hàng/);
  assert.match(legacyPage, /redirect\("\/orders"\)/);
});
