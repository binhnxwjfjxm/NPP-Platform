import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleReadApi } from "./read-api.js";

function context(permissions = []) {
  return {
    installation: { id: "installation-a", nppCode: "NPP-A" },
    auth: { authenticated: true },
    principal: { id: "user:employee-a", permissions, scopes: [] }
  };
}

function request(body) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = "POST";
  return stream;
}

const persistence = {
  async assertReady() {},
  async withTransaction(callback) {
    return callback({ query: async () => ({ rows: [] }) });
  }
};

test("shared MCP report settings read denies workforce user without configuration permission", async () => {
  await assert.rejects(
    () => handleReadApi(
      request({ table: "mcp_report_settings", select: "*" }),
      new URL("http://mcp.local/api/read"),
      context([]),
      {},
      { persistence }
    ),
    (error) => error.code === "permission_denied" && error.statusCode === 403
  );
});

test("shared MCP report settings read allows explicit configuration permission", async () => {
  const result = await handleReadApi(
    request({ table: "mcp_report_setting_groups", select: "*" }),
    new URL("http://mcp.local/api/read"),
    context(["mcp.report-setting.write"]),
    {},
    { persistence }
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.payload.data, []);
});
