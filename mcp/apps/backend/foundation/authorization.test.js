import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeCommand,
  requireAuthenticatedPrincipal,
  requirePermission,
  requireScope
} from "./authorization.js";

function context(overrides = {}) {
  return {
    auth: { authenticated: true },
    principal: {
      id: "service:npp-demo:mcp-v1",
      type: "service",
      employeeId: null,
      permissions: ["mcp.visit.write"],
      scopes: ["mcp:route:route-a"],
      ...overrides
    }
  };
}

test("protected commands deny unauthenticated requests", () => {
  assert.throws(
    () => requireAuthenticatedPrincipal({ auth: { authenticated: false }, principal: context().principal }),
    (error) => error.code === "authentication_required" && error.statusCode === 401
  );
});

test("permission checks are exact and deny empty permission sets", () => {
  assert.equal(requirePermission(context(), "mcp.visit.write").id, "service:npp-demo:mcp-v1");
  assert.throws(
    () => requirePermission(context({ permissions: [] }), "mcp.visit.write"),
    (error) => error.code === "permission_denied" && error.statusCode === 403
  );
  assert.throws(
    () => requirePermission(context({ permissions: ["mcp.visit.read"] }), "mcp.visit.write"),
    (error) => error.code === "permission_denied"
  );
});

test("scope checks accept exact scope or an explicit domain wildcard only", () => {
  assert.equal(requireScope(context(), "mcp:route:route-a").id, "service:npp-demo:mcp-v1");
  assert.equal(requireScope(context({ scopes: ["mcp:*"] }), "mcp:route:route-b").id, "service:npp-demo:mcp-v1");
  assert.throws(
    () => requireScope(context({ scopes: [] }), "mcp:route:route-a"),
    (error) => error.code === "scope_denied" && error.statusCode === 403
  );
});

test("command authorization requires both permission and scope", () => {
  assert.equal(
    authorizeCommand(context(), { permission: "mcp.visit.write", scope: "mcp:route:route-a" }).id,
    "service:npp-demo:mcp-v1"
  );
  assert.throws(
    () => authorizeCommand(context({ scopes: ["mcp:route:route-b"] }), {
      permission: "mcp.visit.write",
      scope: "mcp:route:route-a"
    }),
    /scope_denied/
  );
});

test("invalid policy definitions fail before executing business code", () => {
  assert.throws(() => requirePermission(context(), "*"), /invalid_required_permission/);
  assert.throws(() => requireScope(context(), "all"), /invalid_required_scope/);
});
