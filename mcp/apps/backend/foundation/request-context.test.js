import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticateProxy,
  authenticateRequestContext,
  buildRequestContext,
  normalizeIdempotencyKey,
  normalizeRequestId
} from "./request-context.js";

const config = {
  backendApiToken: "0123456789abcdef0123456789abcdef",
  installationId: "installation-a",
  nppCode: "NPP-A",
  legacyActorId: "service:npp-a:mcp-v1",
  authMode: "proxy-service"
};

function request(headers = {}) {
  return { headers };
}

function authenticatedHeaders(extra = {}) {
  return {
    "x-backend-token": config.backendApiToken,
    ...extra
  };
}

test("proxy token is mandatory", () => {
  assert.throws(() => authenticateProxy(request(), config), /backend_auth_required/);
  assert.throws(
    () => authenticateProxy(request({ "x-backend-token": "wrong" }), config),
    /backend_auth_required/
  );
  assert.doesNotThrow(() => authenticateProxy(
    request({ "x-backend-token": config.backendApiToken }),
    config
  ));
});

test("unverified context ignores installation and actor headers", () => {
  const context = buildRequestContext(
    request({
      "x-request-id": "request_12345678",
      "x-installation-id": "attacker-installation",
      "x-actor-id": "service:attacker:cleanup",
      "x-actor-type": "service",
      "x-actor-authentication": "backend-token",
      "idempotency-key": "order-create-12345678"
    }),
    config
  );
  assert.equal(context.requestId, "request_12345678");
  assert.equal(context.installation.id, "installation-a");
  assert.equal(context.actor.id, "service:npp-a:mcp-v1");
  assert.equal(context.auth.authenticated, false);
  assert.equal(context.idempotencyKey, "order-create-12345678");
});

test("authenticated proxy may provide a complete service actor context", () => {
  const context = authenticateRequestContext(
    request(authenticatedHeaders({
      "x-installation-id": "ignored-installation",
      "x-actor-id": "service:mcp-plan:outlet-media-cleanup",
      "x-actor-type": "service",
      "x-actor-authentication": "backend-token"
    })),
    config
  );

  assert.equal(context.installation.id, "installation-a");
  assert.equal(context.actor.id, "service:mcp-plan:outlet-media-cleanup");
  assert.equal(context.actor.type, "service");
  assert.equal(context.actor.authentication, "backend-token");
  assert.equal(context.auth.authenticated, true);
});

test("partial actor metadata falls back while complete invalid metadata is rejected", () => {
  const partial = authenticateRequestContext(
    request(authenticatedHeaders({ "x-actor-id": "service:mcp-plan:outlet-media-cleanup" })),
    config
  );
  assert.equal(partial.actor.id, "service:npp-a:mcp-v1");

  assert.throws(
    () => authenticateRequestContext(
      request(authenticatedHeaders({
        "x-actor-id": "service:mcp-plan:outlet-media-cleanup",
        "x-actor-type": "user",
        "x-actor-authentication": "backend-token"
      })),
      config
    ),
    /invalid_actor_context/
  );
});

test("invalid request and idempotency IDs are normalized or rejected", () => {
  assert.match(normalizeRequestId("bad"), /^req_/);
  assert.equal(normalizeIdempotencyKey("order-create-12345678"), "order-create-12345678");
  assert.throws(() => normalizeIdempotencyKey("bad key"), /invalid_idempotency_key/);
});
