import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const master = await readFile(new URL("../src/features/mcp/McpMasterView.tsx", import.meta.url), "utf8");
const createProxy = await readFile(new URL("../src/app/api/routes/route.ts", import.meta.url), "utf8");
const updateProxy = await readFile(new URL("../src/app/api/routes/[id]/route.ts", import.meta.url), "utf8");
const gateway = await readFile(new URL("../apps/backend/foundation/gateway.js", import.meta.url), "utf8");
const routeApi = await readFile(new URL("../apps/backend/foundation/route-api.js", import.meta.url), "utf8");

test("route create and update use exact stable idempotency operations", () => {
  assert.match(
    master,
    /idempotentMutationFetch\("\/api\/routes"[\s\S]*?method: "POST"[\s\S]*?operation: "route\.create"/
  );
  assert.match(
    master,
    /idempotentMutationFetch\(`\/api\/routes\/\$\{encodeURIComponent\(routeEditorRoute\.id\)\}`[\s\S]*?method: "PATCH"[\s\S]*?operation: "route\.update"/
  );
  assert.doesNotMatch(master, /fetch\("\/api\/routes"[\s\S]*?method: "POST"/);
});

test("route archive remains outside the DB-only create update slice", () => {
  assert.match(
    master,
    /fetch\(`\/api\/routes\/\$\{encodeURIComponent\(routeEditorRoute\.id\)\}\/archive`[\s\S]*?method: "POST"/
  );
  assert.doesNotMatch(master, /operation: "route\.(?:archive|delete)"/);
  assert.equal(
    routeApi.includes("const routeMatch = pathname.match(/^\\/api\\/routes\\/([^/]+)$/);"),
    true
  );
  assert.match(routeApi, /return null;/);
});

test("same-origin proxies forward create and update to canonical backend routes", () => {
  assert.match(createProxy, /proxyBackendRequest\(request, "\/api\/routes", "POST"\)/);
  assert.match(
    updateProxy,
    /proxyBackendRequest\([\s\S]*?`\/api\/routes\/\$\{encodeURIComponent\(params\.id\)\}`[\s\S]*?"PATCH"/
  );
});

test("Gateway gives route API ownership before transitional and legacy fallback", () => {
  const routeOwner = gateway.indexOf("const routeApi = await handleRouteApi");
  const transitional = gateway.indexOf("const transitional = await handleTransitionalApi");
  const legacy = gateway.indexOf("await proxyToLegacy");
  assert.notEqual(routeOwner, -1);
  assert.equal(routeOwner < transitional, true);
  assert.equal(routeOwner < legacy, true);
  assert.match(gateway, /import \{ handleRouteApi \} from "\.\/route-api\.js"/);
});
