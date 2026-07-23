import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleTransitionalApi } from "./transitional-api.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-setting-route-12345678",
  idempotencyKey: "setting-route-1",
  receivedAt: "2026-07-16T13:30:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

const rpcPathPrefix = ["", "rest", "v1", "rpc"].join("/");

function request(method, body) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = method;
  stream.headers = {};
  return stream;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const cases = [
  {
    name: "group create",
    method: "POST",
    path: "/api/mcp-report-setting-groups",
    body: { title: "Đối thủ" },
    rpc: "mcp_idempotent_create_report_setting_group"
  },
  {
    name: "group update",
    method: "PATCH",
    path: "/api/mcp-report-setting-groups",
    body: { groupId: "group-1", status: "inactive" },
    rpc: "mcp_idempotent_update_report_setting_group"
  },
  {
    name: "item create",
    method: "POST",
    path: "/api/mcp-report-settings",
    body: { groupId: "group-1", label: "Trà sữa" },
    rpc: "mcp_idempotent_create_report_setting_item"
  },
  {
    name: "item update",
    method: "PATCH",
    path: "/api/mcp-report-settings",
    body: { itemId: "item-1", status: "inactive" },
    rpc: "mcp_idempotent_update_report_setting_item"
  }
];

for (const entry of cases) {
  test(`${entry.name} is intercepted by Foundation`, async () => {
    const calls = [];
    const result = await handleTransitionalApi(
      request(entry.method, entry.body),
      new URL(`http://local${entry.path}`),
      context,
      config,
      {
        fetchImpl: async (url, init) => {
          calls.push({ url: String(url), init });
          return jsonResponse({ id: `${entry.name.replace(/\s/g, "-")}-1` });
        }
      }
    );

    assert.equal(result.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith(`${rpcPathPrefix}/${entry.rpc}`));
    const args = JSON.parse(calls[0].init.body);
    assert.equal(args.p_context.requestId, "request-setting-route-12345678");
    assert.equal(args.p_context.actorId, "service:npp-a:mcp-v1");
  });
}
