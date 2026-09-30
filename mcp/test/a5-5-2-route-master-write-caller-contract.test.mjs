import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const master = await readFile(new URL("../src/features/mcp/McpMasterView.tsx", import.meta.url), "utf8");
const companyWorkspace = await readFile(new URL("../../npp-core/web/app/settings/mcp-routes/mcp-route-settings-workspace.tsx", import.meta.url), "utf8");
const gateway = await readFile(new URL("../apps/backend/foundation/gateway.js", import.meta.url), "utf8");
const legacyRuntime = await readFile(new URL("../apps/backend/foundation/legacy-runtime.js", import.meta.url), "utf8");
const routeApi = await readFile(new URL("../apps/backend/foundation/route-api.js", import.meta.url), "utf8");

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

test("PWA no longer owns route master create update archive actions", () => {
  assert.doesNotMatch(master, /submitRouteEditor|openRouteCreate|openRouteEdit|openRouteDelete/);
  assert.doesNotMatch(master, /operation: "route\.(?:create|update|archive|delete)"/);
  assert.doesNotMatch(master, />Tạo tuyến</);
  assert.match(master, /Tuyến được thiết lập tại Công Ty/);
});

test("PWA route-master write proxy endpoints are retired", async () => {
  assert.equal(await exists(new URL("../src/app/api/routes/route.ts", import.meta.url)), false);
  assert.equal(await exists(new URL("../src/app/api/routes/[id]/route.ts", import.meta.url)), false);
  assert.equal(await exists(new URL("../src/app/api/routes/[id]/archive/route.ts", import.meta.url)), false);
});

test("Company route settings own route master mutations with canonical idempotency", () => {
  assert.match(companyWorkspace, /createIdempotencyKey\(operation\)/);
  assert.match(companyWorkspace, /route\.create/);
  assert.match(companyWorkspace, /route\.update/);
  assert.match(companyWorkspace, /route\.archive/);
  assert.match(companyWorkspace, /\/api\/mcp-routes/);
  assert.match(companyWorkspace, />Xóa tuyến</);
  assert.match(routeApi, /method === "POST" && pathname === "\/api\/routes"/);
  assert.match(routeApi, /const routeArchiveMatch = pathname\.match\(\/\^\\\/api\\\/routes/);
  assert.match(routeApi, /const routeMatch = pathname\.match\(\/\^\\\/api\\\/routes/);
});

test("Gateway gives injected route API ownership before transitional and legacy fallback", () => {
  const routeOwner = gateway.indexOf("const routeApi = await legacyHandlers.handleRouteApi");
  const transitional = gateway.indexOf("const transitional = await legacyHandlers.handleTransitionalApi");
  const legacy = gateway.indexOf("if (legacyHandlers.proxyToLegacy)");
  assert.notEqual(routeOwner, -1);
  assert.notEqual(transitional, -1);
  assert.notEqual(legacy, -1);
  assert.equal(routeOwner < transitional, true);
  assert.equal(routeOwner < legacy, true);
  assert.doesNotMatch(gateway, /import \{ handleRouteApi \} from "\.\/route-api\.js"/);
  assert.match(legacyRuntime, /import \{ handleRouteApi \} from "\.\/route-api\.js"/);
  assert.match(legacyRuntime, /handleRouteApi/);
});
