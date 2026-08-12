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

test("E5 returns to the exact visit session only after Core returns an official order id", () => {
  const panel = read("src/features/mcp/McpOfficialOrderPanel.tsx");
  assert.match(panel, /const projection = await submitCoreSalesOrder\(sessionCustomerId, orderId\);[\s\S]*?if \(!projection\.coreSalesOrderId\) throw new Error\("Core chưa trả về mã đơn bán hàng"\);[\s\S]*?router\.push\(returnTo\);/);
  assert.doesNotMatch(panel, /salesChannelId|Hãy chọn kênh bán hàng/);
});
