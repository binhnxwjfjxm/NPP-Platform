import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("session Có đơn is a reporting fact; canonical Orders owns product selection and Sales Order creation", () => {
  const ordersUi = read("src/features/orders/McpCoreOrdersClient.tsx");
  const visitSession = read("src/features/mcp/McpSessionCompactViewFinal2.tsx");
  const lineCard = read("src/features/mcp/McpLineCard.tsx");
  const resultProxy = read("src/app/api/backend/mcp-day/session-customer/result/route.ts");
  assert.match(ordersUi, /fetch\(`\/api\/products\/search/);
  assert.match(ordersUi, /\/api\/backend\/core-sales\/orders/);
  assert.match(ordersUi, /createIdempotencyKey\("mcp\.sales-order\.create"\)/);
  assert.doesNotMatch(visitSession, /ProductPicker|OrderFields|Ghi nhận nhu cầu mua|Lưu nhu cầu mua|\/api\/products\/search|session-customer\/order/);
  assert.match(lineCard, /\/api\/backend\/mcp-day\/session-customer\/result/);
  assert.match(lineCard, /session-customer\.result\.record/);
  assert.match(lineCard, /hasOrder: target/);
  assert.match(lineCard, /createIdempotencyKey\("session-customer\.result\.record"\)/);
  assert.match(resultProxy, /\/api\/mcp-day\/session-customer\/result/);
  assert.equal(existsSync(new URL("../src/app/api/backend/mcp-day/session-customer/order/route.ts", import.meta.url)), false);
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
  assert.match(lineCard, /line\.hasOrder \? "Đã có đơn" : "Có đơn"/);
  assert.match(lineCard, /\[hasOrder, setHasOrder\] = useState\(Boolean\(line\.hasOrder\)\)/);
  assert.match(lineCard, /target = !hasOrder/);
  assert.match(lineCard, /setHasOrder\(target\)[\s\S]*?orderSubmission\.current = null/);
  assert.doesNotMatch(visitSession, /customer-onboarding\/submit|customer-onboarding\/sync|Tiếp tục tạo đơn NPP|\/visits\/order-intent|Ghi nhận nhu cầu mua/);
  assert.doesNotMatch(lineCard, /Đơn NPP|\/visits\/order-intent/);
  assert.doesNotMatch(readonly, /Đơn NPP|\/visits\/order-intent/);
  assert.match(legacyPage, /redirect\("\/orders"\)/);
});

test("MCP source orders stay visible in the canonical NPP Operations Sales Order list", () => {
  const workspace = read("../npp-core/web/app/sales/sales-orders/SalesOrderWorkspace.tsx");
  const repository = read("../npp-core/api/src/db/repositories/sales-order.js");
  assert.match(workspace, /if \(order\.sourceType === 'MCP'\) return 'mcp'/);
  assert.match(workspace, /<option value="mcp">Nhân viên thị trường<\/option>/);
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
  assert.ok(permissionLine);
  const documentedPermissions = new Set(permissionLine.split(",").map((value) => value.trim()).filter(Boolean));
  const manifestPermissions = new Set([...permissionManifest.userFacingWritePermissions, ...permissionManifest.integrationPermissions]);
  assert.deepEqual(documentedPermissions, manifestPermissions);
  assert.match(mcpEnv, /MCP_SERVICE_SCOPES=mcp:warehouse:/);
  assert.match(coreContext, /mcp-sales-order-service/);
  assert.match(coreContext, /coreProductRead/);
  assert.match(coreContext, /coreSalesOrderRead/);
  assert.match(coreContext, /coreSalesOrderCreate/);
  assert.match(coreContext, /warehouseIds: config\.mcpSalesWarehouseIds/);
  assert.match(coreConfig, /MCP_SALES_WAREHOUSE_IDS/);
  assert.match(coreConfig, /mcp_sales_token_reuse_forbidden/);
});

test("legacy projection columns stay inert for compatibility; no migration is added in cleanup", () => {
  const migration = read("../database/migrations/mcp/007_mcp_core_sales_order_sync.sql");
  const registry = read("apps/backend/foundation/migrations/index.js");
  assert.match(migration, /core_sales_order_id uuid/);
  assert.match(migration, /core_sales_order_fingerprint char\(64\)/);
  assert.match(registry, /mcp_007_core_sales_order_sync/);
});
