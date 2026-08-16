import test from "node:test";
import assert from "node:assert/strict";
import { executeWriteCommand } from "./write-command.js";
import { withFoundationRequestContext } from "./request-context-store.js";

function context({ id, permissions }) {
  return Object.freeze({
    requestId: "req_workforce_access",
    installation: Object.freeze({ id: "installation-a", nppCode: "NPP-A" }),
    actor: Object.freeze({ id: "service:npp-a:mcp", type: "service", authentication: "backend-token" }),
    principal: Object.freeze({
      id,
      type: id.startsWith("user:") ? "user" : "service",
      authentication: id.startsWith("user:") ? "core-workforce-session" : "backend-token",
      employeeId: id.startsWith("user:") ? "11111111-1111-4111-8111-111111111111" : null,
      roles: Object.freeze([]),
      permissions: Object.freeze(permissions),
      scopes: Object.freeze([])
    }),
    auth: Object.freeze({ mode: "proxy-service", authenticated: true }),
    idempotencyKey: "route.create.access-test",
    receivedAt: "2026-08-16T00:00:00.000Z"
  });
}

const serviceContext = context({ id: "service:npp-a:mcp", permissions: ["mcp.route.write"] });
const workforceContext = context({ id: "user:11111111-1111-4111-8111-111111111111", permissions: [] });

test("active workforce request context overrides adapter service principal for authorization", async () => {
  await assert.rejects(
    () => withFoundationRequestContext(workforceContext, () => executeWriteCommand({
      context: serviceContext,
      commandName: "mcp.route.create",
      permission: "mcp.route.write",
      payload: { routeName: "Tuyến A" },
      aggregate: { type: "route", id: "route-a", version: 1 },
      eventType: "mcp.route.created",
      transaction: async () => { throw new Error("transaction_should_not_run"); },
      mutate: async () => ({ id: "route-a" })
    })),
    (error) => error.code === "permission_denied" && error.statusCode === 403
  );
});
