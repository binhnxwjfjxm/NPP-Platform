import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticateProxy,
  authenticateRequestContext,
  buildRequestContext,
  normalizeIdempotencyKey,
  normalizePrincipal,
  normalizeRequestId
} from "./request-context.js";

const config = {
  backendApiToken: "0123456789abcdef0123456789abcdef",
  installationId: "installation-a",
  nppCode: "NPP-A",
  legacyActorId: "service:npp-a:mcp-v1",
  authMode: "proxy-service",
  servicePrincipal: {
    id: "service:npp-a:mcp-v1",
    type: "service",
    authentication: "backend-token",
    employeeId: null,
    roles: [],
    permissions: [],
    scopes: []
  }
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

test("unverified context ignores installation, actor and authorization headers", () => {
  const context = buildRequestContext(
    request({
      "x-request-id": "request_12345678",
      "x-installation-id": "attacker-installation",
      "x-actor-id": "service:attacker:cleanup",
      "x-actor-type": "service",
      "x-actor-authentication": "backend-token",
      "x-employee-id": "attacker-employee",
      "x-roles": "mcp.owner",
      "x-permissions": "mcp.visit.write",
      "x-scopes": "mcp:*",
      "idempotency-key": "order-create-12345678"
    }),
    config
  );
  assert.equal(context.requestId, "request_12345678");
  assert.equal(context.installation.id, "installation-a");
  assert.equal(context.actor.id, "service:npp-a:mcp-v1");
  assert.equal(context.principal.id, "service:npp-a:mcp-v1");
  assert.deepEqual(context.principal.permissions, []);
  assert.deepEqual(context.principal.scopes, []);
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
  assert.equal(context.principal.id, "service:npp-a:mcp-v1");
  assert.equal(context.auth.authenticated, true);
});

test("server-owned resolver may attach an immutable employee principal", () => {
  const context = authenticateRequestContext(
    request(authenticatedHeaders({
      "x-employee-id": "attacker",
      "x-permissions": "mcp.admin"
    })),
    config,
    {
      principal: {
        id: "user:employee-a",
        type: "user",
        authentication: "identity-resolver",
        employeeId: "employee-a",
        roles: ["mcp.field-employee", "mcp.field-employee"],
        permissions: ["mcp.visit.write"],
        scopes: ["mcp:route:route-a"]
      }
    }
  );

  assert.equal(context.principal.id, "user:employee-a");
  assert.equal(context.principal.employeeId, "employee-a");
  assert.deepEqual(context.principal.roles, ["mcp.field-employee"]);
  assert.deepEqual(context.principal.permissions, ["mcp.visit.write"]);
  assert.deepEqual(context.principal.scopes, ["mcp:route:route-a"]);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.principal), true);
  assert.equal(Object.isFrozen(context.principal.permissions), true);
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

test("principal validation rejects invalid permissions, scopes and service employees", () => {
  assert.throws(
    () => normalizePrincipal({
      id: "user:employee-a",
      type: "user",
      authentication: "identity-resolver",
      permissions: ["*"],
      scopes: []
    }, config),
    /invalid_principal_permission/
  );
  assert.throws(
    () => normalizePrincipal({
      id: "service:npp-a:mcp-v1",
      type: "service",
      authentication: "backend-token",
      employeeId: "employee-a"
    }, config),
    /service_principal_employee_forbidden/
  );
});

test("invalid request and idempotency IDs are normalized or rejected", () => {
  assert.match(normalizeRequestId("bad"), /^req_/);
  assert.equal(normalizeIdempotencyKey("order-create-12345678"), "order-create-12345678");
  assert.throws(() => normalizeIdempotencyKey("bad key"), /invalid_idempotency_key/);
});
