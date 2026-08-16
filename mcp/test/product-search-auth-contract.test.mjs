import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

test("MCP product search carries the trusted workforce identity to the backend", () => {
  const middleware = source("../src/middleware.ts");
  const productRoute = source("../src/app/api/products/search/route.ts");
  const backendProxy = source("../src/lib/api/backend-proxy.ts");

  assert.ok(middleware.includes('"/api/products/:path*"'), "product API must pass through MCP workforce middleware");
  assert.match(productRoute, /proxyBackendRequest\(request, "\/api\/core-sales\/products\/search", "GET"\)/);
  assert.match(backendProxy, /if \(authorization\) headers\.Authorization = authorization/);
});
