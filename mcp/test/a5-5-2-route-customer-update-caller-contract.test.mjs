import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const master = await readFile(new URL("../src/features/mcp/McpMasterView.tsx", import.meta.url), "utf8");
const proxy = await readFile(new URL("../src/app/api/route-customers/[id]/route.ts", import.meta.url), "utf8");
const routeApi = await readFile(new URL("../apps/backend/foundation/route-api.js", import.meta.url), "utf8");
const typedOwner = await readFile(new URL("../apps/backend/foundation/route-customer-update-mutations.js", import.meta.url), "utf8");

test("route-customer edit uses the exact stable update operation", () => {
  assert.match(
    master,
    /idempotentMutationFetch\(`\/api\/route-customers\/\$\{encodeURIComponent\(customerEditorCustomer\.id\)\}`[\s\S]*?method: "PATCH"[\s\S]*?operation: "route-customer\.update"/
  );
  assert.doesNotMatch(
    master,
    /fetch\(`\/api\/route-customers\/\$\{encodeURIComponent\(customerEditorCustomer\.id\)\}`[\s\S]*?method: "PATCH"/
  );
});

test("route-customer archive remains outside this DB-only slice", () => {
  assert.match(
    master,
    /fetch\(`\/api\/route-customers\/\$\{encodeURIComponent\(customerEditorCustomer\.id\)\}\/archive`[\s\S]*?method: "POST"/
  );
  assert.doesNotMatch(master, /operation: "route-customer\.(?:archive|delete)"/);
  assert.equal(
    routeApi.includes("const routeCustomerMatch = pathname.match(/^\\/api\\/route-customers\\/([^/]+)$/);"),
    true
  );
});

test("same-origin proxy forwards PATCH to the canonical backend path", () => {
  assert.match(
    proxy,
    /proxyBackendRequest\([\s\S]*?`\/api\/route-customers\/\$\{encodeURIComponent\(params\.id\)\}`[\s\S]*?"PATCH"/
  );
});

test("typed owner calls one literal GPS-aware persisted wrapper", () => {
  assert.match(
    typedOwner,
    /supabaseRpc\(config, "mcp_idempotent_update_route_customer"/
  );
  for (const argument of [
    "p_geo_lat",
    "p_geo_lng",
    "p_geo_accuracy",
    "p_geo_source",
    "p_google_maps_url",
    "p_context"
  ]) {
    assert.match(typedOwner, new RegExp(`${argument}:`));
  }
});
