import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const salesOrdersPageSource = readFileSync(
  new URL("../../npp-core/web/app/sales/sales-orders/page.tsx", import.meta.url),
  "utf8",
);

test("sales orders page supports MCP monitoring and conversion in one workspace", () => {
  assert.match(salesOrdersPageSource, /sourceType/);
  assert.match(salesOrdersPageSource, /websiteSourceId/);
  assert.match(salesOrdersPageSource, /mcpRecordType/);
  assert.match(salesOrdersPageSource, /mcpSourceCode/);
  assert.match(salesOrdersPageSource, /mcpStatus/);
  assert.match(salesOrdersPageSource, /sourceCreatedAt/);
  assert.match(salesOrdersPageSource, /Nhân viên thị trường|Website/);
  assert.doesNotMatch(salesOrdersPageSource, /<option value="MCP">MCP<\/option>/);
});
