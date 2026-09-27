import test from "node:test";
import assert from "node:assert/strict";
import {
  handleMobileAuthApi,
  mobilePrincipalFromCoreMe,
  resolveMobileSessionPrincipal
} from "./mobile-auth.js";

const employeeId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const warehouseId = "33333333-3333-4333-8333-333333333333";

function config(overrides = {}) {
  return {
    coreAuth: {
      configured: true,
      baseUrl: "https://company.example.com",
      timeoutMs: 1000
    },
    servicePrincipal: {
      permissions: ["mcp.report-setting.write"],
      scopes: ["mcp:branch:44444444-4444-4444-8444-444444444444"]
    },
    ...overrides
  };
}

function request({ method = "GET", authorization = "", body = "" } = {}) {
  async function* chunks() {
    if (body) yield Buffer.from(body);
  }
  return {
    method,
    headers: authorization ? { authorization } : {},
    [Symbol.asyncIterator]: chunks
  };
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("mobile login forces the mobile source app and never accepts client source override", async () => {
  let received = null;
  const result = await handleMobileAuthApi(
    request({
      method: "POST",
      body: JSON.stringify({
        loginName: "staff.test",
        password: "secret-value",
        ownerCode: "123456",
        sourceApp: "attacker-app"
      })
    }),
    new URL("https://mcp.example.com/api/mobile-auth/login"),
    config(),
    {
      requestId: "mobile_login_12345678",
      fetchImpl: async (_url, options) => {
        received = JSON.parse(options.body);
        return jsonResponse(200, {
          data: {
            token: `nppusr.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${"x".repeat(43)}`,
            session: { sourceApp: "mcp-field-mobile" },
            user: { employeeId }
          }
        });
      }
    }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(received.loginName, "staff.test");
  assert.equal(received.password, "secret-value");
  assert.equal(received.ownerCode, "123456");
  assert.equal(received.sourceApp, "mcp-field-mobile");
});

test("mobile principal keeps only MCP permissions and maps Công Ty scopes", () => {
  const principal = mobilePrincipalFromCoreMe({
    employeeId,
    roles: ["sales", "system:security-owner"],
    permissions: [
      "mcp.session.write",
      "mcp.order.write",
      "core.inventory.read",
      "mcp.session.write"
    ],
    scopes: {
      branchIds: [branchId],
      warehouseIds: [warehouseId],
      territoryIds: []
    },
    session: {
      loginName: "staff.test",
      employeeFullName: "Nhân viên A"
    }
  }, config());

  assert.equal(principal.id, `user:${employeeId}`);
  assert.equal(principal.authentication, "core-workforce-session");
  assert.deepEqual(principal.roles, ["mcp.installation-owner"]);
  assert.deepEqual(principal.permissions, [
    "mcp.order.write",
    "mcp.report-setting.write",
    "mcp.session.write"
  ]);
  assert.deepEqual(principal.scopes, [
    `mcp:branch:${branchId}`,
    "mcp:branch:44444444-4444-4444-8444-444444444444",
    `mcp:warehouse:${warehouseId}`
  ]);
});

test("mobile session resolver requires session created for MCP Field mobile", async () => {
  const token = `nppusr.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${"x".repeat(43)}`;
  await assert.rejects(
    () => resolveMobileSessionPrincipal(
      request({ authorization: `Bearer ${token}` }),
      config(),
      {
        requestId: "mobile_me_12345678",
        fetchImpl: async () => jsonResponse(200, {
          data: {
            employeeId,
            permissions: ["mcp.session.write"],
            scopes: { branchIds: [], warehouseIds: [], territoryIds: [] },
            sourceApp: "mcp-field-web",
            session: {
              sourceApp: "mcp-field-web",
              loginName: "staff.test",
              employeeFullName: "Nhân viên A"
            }
          }
        })
      }
    ),
    (error) => error.code === "unauthorized" && error.statusCode === 401
  );
});

test("mobile session resolver returns an MCP principal for a valid mobile token", async () => {
  const token = `nppusr.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.${"x".repeat(43)}`;
  const result = await resolveMobileSessionPrincipal(
    request({ authorization: `Bearer ${token}` }),
    config(),
    {
      requestId: "mobile_me_87654321",
      fetchImpl: async () => jsonResponse(200, {
        data: {
          employeeId,
          roles: [],
          permissions: ["mcp.session.write", "core.inventory.read"],
          scopes: { branchIds: [branchId], warehouseIds: [], territoryIds: [] },
          sourceApp: "mcp-field-mobile",
          session: {
            sourceApp: "mcp-field-mobile",
            loginName: "staff.test",
            employeeFullName: "Nhân viên A",
            expiresAt: "2026-09-28T00:00:00.000Z"
          }
        }
      })
    }
  );

  assert.equal(result.principal.employeeId, employeeId);
  assert.deepEqual(result.principal.permissions, ["mcp.session.write"]);
  assert.deepEqual(result.principal.scopes, [`mcp:branch:${branchId}`]);
});

test("mobile auth me requires a bearer session", async () => {
  await assert.rejects(
    () => handleMobileAuthApi(
      request(),
      new URL("https://mcp.example.com/api/mobile-auth/me"),
      config(),
      { requestId: "mobile_me_no_token" }
    ),
    (error) => error.code === "unauthorized" && error.statusCode === 401
  );
});
