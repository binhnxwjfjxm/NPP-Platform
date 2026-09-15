import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("Admin navigation does not wait on an auth network round-trip", () => {
  const middleware = read("../admin/web/middleware.ts");
  assert.match(middleware, /ADMIN_SESSION_COOKIE/);
  assert.match(middleware, /return NextResponse\.next\(\);/);
  assert.doesNotMatch(middleware, /sessionIsActive|sessionCheckUrl|await fetch/);
});

test("MCP visits renders local-first instead of server-loading route, day and customers before navigation", () => {
  const page = read("src/app/visits/page.tsx");
  const local = read("src/features/mcp/VisitsLocalPage.tsx");
  const hook = read("src/lib/local-read/use-mcp-visit-day.ts");
  const route = read("src/app/api/local-read/mcp-visit-day/route.ts");

  assert.match(page, /VisitsLocalPage/);
  assert.doesNotMatch(page, /loadMcpSessions|loadRoutesData|loadMcpDayData|loadRouteCustomersData/);
  assert.match(local, /useMcpShellSnapshot\(\)/);
  assert.match(local, /useMcpVisitDay\(routeId, date\)/);
  assert.match(hook, /createLocalReadCache/);
  assert.match(hook, /readLocalFirst/);
  assert.match(hook, /MCP_LOCAL_READ_REFRESH_EVENT/);
  assert.match(route, /loadMcpDayData/);
  assert.match(route, /createHash\("sha256"\)/);
});

test("MCP keeps SKU catalog in IndexedDB without persisted prices and warms it before order entry", () => {
  const cache = read("src/features/orders/mcp-product-local-cache.ts");
  const warmup = read("src/features/orders/McpProductCatalogWarmup.tsx");
  const layout = read("src/app/layout.tsx");
  const catalogRoute = read("src/app/api/products/catalog/route.ts");

  const rowStart = cache.indexOf("export type McpProductCatalogRow");
  const rowEnd = cache.indexOf("type CatalogRecord", rowStart);
  assert.ok(rowStart >= 0 && rowEnd > rowStart);
  assert.doesNotMatch(cache.slice(rowStart, rowEnd), /price/);
  assert.match(cache, /indexedDB\.open\(CACHE_DB_NAME, 1\)/);
  assert.match(cache, /currentMcpLocalUserId/);
  assert.match(cache, /searchMcpProductCatalog/);
  assert.match(cache, /\/api\/products\/catalog/);
  assert.match(warmup, /warmMcpProductCatalog/);
  assert.match(layout, /McpProductCatalogWarmup/);
  assert.match(catalogRoute, /catalog", "all"/);
  assert.match(catalogRoute, /includePrice", "false"/);
});

test("MCP order search shows local SKU first and resolves price only afterward", () => {
  const sheet = read("src/features/orders/CoreOrderCreateSheet.tsx");
  const cache = read("src/features/orders/mcp-product-local-cache.ts");
  const searchRoute = read("src/app/api/products/search/route.ts");

  assert.match(sheet, /searchMcpProductCatalog\(query, category, brand, 100\)/);
  assert.match(sheet, /setProducts\(nextProducts\)/);
  assert.match(sheet, /setLoadingProducts\(false\)/);
  assert.match(sheet, /loadMcpProductPrices\(query, category, brand\)/);
  assert.doesNotMatch(sheet, /setTimeout\(\(\) => \{\s*void loadProducts[\s\S]*?250/);
  assert.doesNotMatch(sheet, /fetch\(`\/api\/products\/search/);
  assert.match(cache, /prices:\s*"1"/);
  assert.match(searchRoute, /includePrices/);
  assert.match(searchRoute, /includePrice", "false"/);
  assert.match(searchRoute, /includePrice", "true"/);
});
