import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("E5 maps MCP source to its canonical system sales channel before generic default", () => {
  const entry = read("../npp-core/api/src/services/sales-order-entry.js");
  const repository = read("../npp-core/api/src/db/repositories/system-sales-channel.js");

  assert.match(entry, /SOURCE_CHANNEL_BY_TYPE = Object\.freeze/);
  assert.match(entry, /code: 'MCP'/);
  assert.match(entry, /sourceChannelDefinition\(normalized\.payload\)/);
  assert.match(entry, /systemSalesChannelRepository\.ensureSystemSalesChannel/);
  assert.match(entry, /actorId: args\.requestContext\.actorId/);
  assert.match(entry, /Kênh bán hàng \$\{canonicalSourceChannel\.code\} đang ngừng hoạt động/);

  const sourceIndex = entry.indexOf("const canonicalSourceChannel = sourceChannelDefinition(normalized.payload)");
  const defaultIndex = entry.indexOf("commercialRepository.getDefaultSalesChannelId", sourceIndex);
  assert.ok(sourceIndex >= 0 && defaultIndex > sourceIndex, "MCP source channel must resolve before generic default");

  assert.match(repository, /ON CONFLICT \(installation_id, code\) DO NOTHING/);
  assert.match(repository, /if \(existing\) return existing/);
  assert.doesNotMatch(repository, /UPDATE shared\.sales_channels[\s\S]*is_active\s*=\s*true/i);
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
