import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("purchase-demand picker routes only to canonical NPP Core Sales products", () => {
  const api = read("apps/backend/foundation/core-sales-api.js");
  const client = read("apps/backend/foundation/core-sales-client.js");
  const runtime = read("apps/backend/foundation/typed-runtime.js");
  const searchProxy = read("src/app/api/products/search/route.ts");
  const variantsProxy = read("src/app/api/products/[id]/variants/route.ts");
  const demandUi = read("src/features/mcp/McpSessionCompactViewFinal2.tsx");
  const orderCreateUi = read("src/features/orders/OrderCreateSheet.tsx");
  assert.match(api, /searchCoreSalesSkus/);
  assert.match(api, /listCoreProductVariants/);
  assert.match(api, /item\.id === variant\.id && item\.productId === productId/);
  assert.match(api, /MAX_VERIFIED_VARIANTS = 50/);
  assert.match(api, /VARIANT_CHECK_CONCURRENCY = 5/);
  assert.match(api, /catalogSource: "NPP_CORE"/);
  assert.match(api, /pathname === "\/api\/core-sales\/products\/search"/);
  assert.ok(api.includes("pathname.match(/^\\/api\\/core-sales\\/products\\/([^/]+)\\/variants$/)"));
  assert.match(client, /\/api\/products\/\$\{encodeURIComponent\(normalized\)\}\/variants/);
  assert.match(runtime, /handleCoreSalesApi/);
  assert.match(searchProxy, /\/api\/core-sales\/products\/search/);
  assert.match(variantsProxy, /\/api\/core-sales\/products\/\$\{encodeURIComponent\(productId\)\}\/variants/);
  assert.match(demandUi, /fetch\(`\/api\/products\/search/);
  assert.match(demandUi, /fetch\(`\/api\/products\/\$\{encodeURIComponent\(productId\)\}\/variants/);
  assert.match(demandUi, /price: catalogPrice\(item\.price\)/);
  assert.match(demandUi, /if \(normalized === ""\) return null/);
  assert.match(orderCreateUi, /price: catalogPrice\(item\.price\)/);
  assert.match(orderCreateUi, /"Chưa có giá Core"/);
});

test("official MCP orders use only the direct canonical Core boundary; legacy order-intent runtime is retired", () => {
  const api = read("apps/backend/foundation/core-sales-api.js");
  const directService = read("apps/backend/foundation/direct-sales-orders.js");
  const ordersUi = read("src/features/orders/McpCoreOrdersClient.tsx");
  const visitSession = read("src/features/mcp/McpSessionCompactViewFinal2.tsx");
  const lineCard = read("src/features/mcp/McpLineCard.tsx");
  const readonly = read("src/features/mcp/McpSessionReadonlyView.tsx");
  const legacyPage = read("src/app/visits/order-intent/page.tsx");

  assert.match(api, /pathname === "\/api\/core-sales\/orders"/);
  assert.doesNotMatch(api, /\/api\/mcp-day\/session-customer\/sales-order/);
  assert.match(directService, /sourceType: "MCP"/);
  assert.match(directService, /sourceId: idempotencyKey/);
  assert.match(directService, /sourceOutletId:/);
  assert.match(directService, /collectionPolicy: "PREPAID"/);
  assert.match(directService, /isValidIdempotencyKey/);
  assert.match(ordersUi, /createIdempotencyKey\("mcp\.sales-order\.create"\)/);
  assert.match(ordersUi, /\/api\/backend\/core-sales\/orders/);
  assert.doesNotMatch(ordersUi, /sessionCustomerId|orderIntentId|unitPrice/);

  assert.match(visitSession, /Đã ghi nhận nhu cầu mua để báo cáo/);
  assert.doesNotMatch(visitSession, /customer-onboarding\/submit|customer-onboarding\/sync|Tiếp tục tạo đơn NPP|\/visits\/order-intent/);
  assert.doesNotMatch(lineCard, /Đơn NPP|\/visits\/order-intent/);
  assert.doesNotMatch(readonly, /Đơn NPP|\/visits\/order-intent/);
  assert.match(legacyPage, /redirect\("\/orders"\)/);
});

test("MCP source orders stay visible in the canonical NPP Operations Sales Order list", () => {
  const workspace = read("../npp-core/web/app/sales/sales-orders/SalesOrderWorkspace.tsx");
  const repository = read("../npp-core/api/src/db/repositories/sales-order.js");
  assert.match(workspace, /if \(order\.sourceType === 'MCP'\) return 'mcp'/);
  assert.match(workspace, /const \[source, setSource\] = useState<OrderSourceFilter>\('all'\)/);
  assert.match(workspace, /<option value="mcp">MCP<\/option>/);
  assert.match(repository, /so\.source_type, so\.source_id, so\.source_outlet_id/);
  assert.doesNotMatch(repository, /source_type\s*(?:<>|!=)\s*['"]MCP['"]/i);
});

test("MCP and Core Sales principals are least privilege and warehouse scoped", () => {
  const mcpApi = read("apps/backend/foundation/core-sales-api.js");
  const mcpEnv = read("apps/backend/.env.example");
  const permissionManifest = JSON.parse(read("apps/backend/config/mcp-service-permissions.json"));
  const coreContext = read("../npp-core/api/src/request-context.js");
  const coreConfig = read("../npp-core/api/src/config.js");
  assert.match(mcpApi, /mcp\.sales-order\.read/);
  assert.match(mcpApi, /mcp\.sales-order\.create/);
  assert.match(mcpApi, /mcp:warehouse:/);
  assert.match(mcpApi, /authorizeCommand/);

  const permissionLine = mcpEnv.match(/^MCP_SERVICE_PERMISSIONS=(.+)$/m)?.[1];
  assert.ok(permissionLine, "MCP_SERVICE_PERMISSIONS must be documented");
  const documentedPermissions = new Set(permissionLine.split(",").map((value) => value.trim()).filter(Boolean));
  const manifestPermissions = new Set([...permissionManifest.userFacingWritePermissions, ...permissionManifest.integrationPermissions]);
  assert.deepEqual(documentedPermissions, manifestPermissions);
  assert.ok(documentedPermissions.has("mcp.sales-order.read"));
  assert.ok(documentedPermissions.has("mcp.sales-order.create"));
  for (const permission of documentedPermissions) assert.doesNotMatch(permission, /\*/);

  assert.match(mcpEnv, /MCP_SERVICE_SCOPES=mcp:warehouse:/);
  assert.match(coreContext, /mcp-sales-order-service/);
  assert.match(coreContext, /coreProductRead/);
  assert.match(coreContext, /coreSalesOrderRead/);
  assert.match(coreContext, /coreSalesOrderCreate/);
  assert.match(coreContext, /warehouseIds: config\.mcpSalesWarehouseIds/);
  assert.doesNotMatch(coreContext, /roles: \['mcp-sales-order-service'\],[\s\S]*?coreProductWrite/);
  assert.match(coreConfig, /MCP_SALES_WAREHOUSE_IDS/);
  assert.match(coreConfig, /mcp_sales_token_reuse_forbidden/);
});

test("legacy projection columns stay inert for compatibility; no migration is added in cleanup", () => {
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
  assert.match(iconRoute, /new URL\("\/npp-app-icon\.png"/);
});
