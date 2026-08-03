import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("existing MCP product routes are overridden by canonical NPP Core Sales SKU search", () => {
  const api = read("apps/backend/foundation/core-sales-api.js");
  const client = read("apps/backend/foundation/core-sales-client.js");
  const runtime = read("apps/backend/foundation/typed-runtime.js");
  const demandUi = read("src/features/mcp/McpSessionCompactViewFinal2.tsx");
  assert.match(api, /searchCoreSalesSkus/);
  assert.match(api, /listCoreProductVariants/);
  assert.match(api, /item\.id === variant\.id && item\.productId === productId/);
  assert.match(api, /catalogSource: "NPP_CORE"/);
  assert.match(api, /pathname === "\/api\/products\/search"/);
  assert.match(client, /\/api\/products\/\$\{encodeURIComponent\(normalized\)\}\/variants/);
  assert.match(runtime, /handleCoreSalesApi/);
  assert.match(demandUi, /fetch\(`\/api\/products\/search/);
  assert.match(demandUi, /fetch\(`\/api\/products\/\$\{encodeURIComponent\(productId\)\}\/variants/);
});

test("official order creation is explicit, pending-safe and reachable after session lock", () => {
  const service = read("apps/backend/foundation/sales-order-sync.js");
  const client = read("apps/backend/foundation/core-sales-client.js");
  const card = read("src/features/mcp/McpLineCard.tsx");
  const readonly = read("src/features/mcp/McpSessionReadonlyView.tsx");
  const panel = read("src/features/mcp/McpOfficialOrderPanel.tsx");
  const page = read("src/app/visits/order-intent/page.tsx");
  assert.match(service, /sourceType: "MCP"/);
  assert.match(service, /sourceId: row\.order_id/);
  assert.match(service, /sourceOutletId: sourceOutletId\(row\)/);
  assert.match(service, /COLLECT_ON_DELIVERY/);
  assert.match(service, /mcp-sales-order-\$\{row\.order_id\}/);
  assert.match(client, /\/api\/sales-orders/);
  assert.doesNotMatch(client, /\/confirm|amendments|\/cancel/);
  assert.match(card, /line\.orderId \?/);
  assert.match(card, /Đơn NPP/);
  assert.match(readonly, /line\.orderId \?/);
  assert.match(readonly, /\/visits\/order-intent/);
  assert.match(readonly, /Đơn NPP/);
  assert.match(panel, /Tạo đơn nháp NPP/);
  assert.match(panel, /submitCoreSalesOrder/);
  assert.match(panel, /const \[busy, setBusy\] = useState\(false\)/);
  assert.match(panel, /if \(busy\) return/);
  assert.match(panel, /setBusy\(true\)/);
  assert.match(panel, /\.finally\(\(\) => setBusy\(false\)\)/);
  assert.doesNotMatch(panel, /useTransition/);
  assert.match(page, /McpOfficialOrderPanel/);
  assert.doesNotMatch(panel, /confirmCoreSalesOrder/);
});

test("MCP Core Sales principal is least privilege and warehouse scoped", () => {
  const context = read("../npp-core/api/src/request-context.js");
  const config = read("../npp-core/api/src/config.js");
  assert.match(context, /mcp-sales-order-service/);
  assert.match(context, /coreProductRead/);
  assert.match(context, /coreSalesOrderRead/);
  assert.match(context, /coreSalesOrderCreate/);
  assert.match(context, /warehouseIds: config\.mcpSalesWarehouseIds/);
  assert.doesNotMatch(context, /roles: \['mcp-sales-order-service'\],[\s\S]*?coreProductWrite/);
  assert.match(config, /MCP_SALES_WAREHOUSE_IDS/);
  assert.match(config, /mcp_sales_token_reuse_forbidden/);
});

test("structured MCP projection and square NPP PWA icons are registered", () => {
  const migration = read("../database/migrations/mcp/007_mcp_core_sales_order_sync.sql");
  const registry = read("apps/backend/foundation/migrations/index.js");
  const manifest = read("src/app/manifest.ts");
  const iconRoute = read("src/app/api/pwa-icon/route.ts");
  assert.match(migration, /core_sales_order_id uuid/);
  assert.match(migration, /core_sales_order_fingerprint char\(64\)/);
  assert.match(registry, /mcp_007_core_sales_order_sync/);
  assert.match(manifest, /192x192/);
  assert.match(manifest, /512x512/);
  assert.match(manifest, /maskable=1/);
  assert.doesNotMatch(manifest, /src: "\/npp-app-icon\.png"/);
  assert.match(iconRoute, /new URL\("\/npp-app-icon\.png"/);
  assert.match(iconRoute, /width: size/);
  assert.match(iconRoute, /height: size/);
});
