import test from "node:test";
import assert from "node:assert/strict";
import { authenticateRequestContext } from "./request-context.js";

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
    permissions: ["mcp.route.write", "mcp.report-setting.write", "mcp.session.write"],
    scopes: ["mcp:*"]
  }
};

function request(authorization) {
  return { headers: { "x-backend-token": config.backendApiToken, authorization } };
}

function basic(parts) {
  return `Basic ${Buffer.from(parts.join("|")).toString("base64")}`;
}

test("v4 workforce authorization preserves only trusted workforce MCP permissions and scopes", () => {
  const employeeId = "11111111-1111-4111-8111-111111111111";
  const authorization = basic([
    "v4",
    "employee",
    employeeId,
    encodeURIComponent("Nhân viên thị trường"),
    "0",
    encodeURIComponent(JSON.stringify(["mcp.session.write", "mcp.sales-order.create"])),
    encodeURIComponent(JSON.stringify(["mcp:warehouse:22222222-2222-4222-8222-222222222222"]))
  ]);
  const context = authenticateRequestContext(request(authorization), config);
  assert.equal(context.principal.employeeId, employeeId);
  assert.deepEqual(context.principal.permissions, ["mcp.sales-order.create", "mcp.session.write"]);
  assert.deepEqual(context.principal.scopes, ["mcp:warehouse:22222222-2222-4222-8222-222222222222"]);
  assert.equal(context.principal.permissions.includes("mcp.route.write"), false);
  assert.equal(context.principal.permissions.includes("mcp.report-setting.write"), false);
});

test("legacy non-owner workforce authorization fails closed instead of inheriting service permissions", () => {
  const employeeId = "11111111-1111-4111-8111-111111111111";
  for (const parts of [
    ["v2", "employee", employeeId, encodeURIComponent("Nhân viên")],
    ["v3", "employee", employeeId, encodeURIComponent("Nhân viên"), "0"]
  ]) {
    const context = authenticateRequestContext(request(basic(parts)), config);
    assert.deepEqual(context.principal.permissions, []);
    assert.deepEqual(context.principal.scopes, []);
  }
});

test("owner bootstrap keeps configured MCP permissions while normal users do not", () => {
  const employeeId = "11111111-1111-4111-8111-111111111111";
  const authorization = basic([
    "v4",
    "owner",
    employeeId,
    encodeURIComponent("Owner"),
    "1",
    encodeURIComponent(JSON.stringify([])),
    encodeURIComponent(JSON.stringify([]))
  ]);
  const context = authenticateRequestContext(request(authorization), config);
  assert.deepEqual(context.principal.roles, ["mcp.installation-owner"]);
  assert.deepEqual(context.principal.permissions, ["mcp.report-setting.write", "mcp.route.write", "mcp.session.write"]);
  assert.deepEqual(context.principal.scopes, ["mcp:*"]);
});
