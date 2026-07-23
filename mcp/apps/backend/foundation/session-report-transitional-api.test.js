import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleTransitionalApi } from "./transitional-api.js";

const config = {
  supabaseUrl: "https://project.example.com",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-report-route-12345678",
  idempotencyKey: "report-route-1",
  receivedAt: "2026-07-16T12:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

function request(body) {
  const stream = Readable.from([JSON.stringify(body)]);
  stream.method = "POST";
  stream.headers = {};
  return stream;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("session report snapshot route is intercepted by Foundation and calls the canonical RPC", async () => {
  const calls = [];
  const result = await handleTransitionalApi(
    request({ sessionId: "session-1", source: "close_session" }),
    new URL("http://local/api/mcp-session-report"),
    context,
    config,
    {
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ id: "report-1", session_id: "session-1" });
      }
    }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.id, "report-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_create_session_report_snapshot$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_session_id: "session-1",
    p_source: "close_session",
    p_context: {
      requestId: "request-report-route-12345678",
      idempotencyKey: "report-route-1",
      receivedAt: "2026-07-16T12:00:00.000Z",
      installationId: "installation-a",
      nppCode: "NPP-A",
      actorId: "service:npp-a:mcp-v1",
      actorType: "service",
      actorAuthentication: "proxy-token"
    }
  });
});

test("session report AI route is intercepted by Foundation and calls the atomic RPC", async () => {
  const calls = [];
  const result = await handleTransitionalApi(
    request({
      sessionId: "session-1",
      aiResult: { summary: "Phiên ổn" },
      analyzedAt: "2026-07-16T12:30:00.000Z"
    }),
    new URL("http://local/api/mcp-session-report/ai-result"),
    context,
    config,
    {
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ row: { id: "report-1" }, analyzedAt: "2026-07-16T12:30:00.000Z" });
      }
    }
  );

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.data.row.id, "report-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_save_session_report_ai_result$/);
  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_session_id, "session-1");
  assert.deepEqual(args.p_ai_result, { summary: "Phiên ổn" });
  assert.equal(args.p_context.requestId, "request-report-route-12345678");
  assert.equal(args.p_context.actorId, "service:npp-a:mcp-v1");
});
