import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionReportSnapshot,
  saveSessionReportAiResult
} from "./session-report-mutations.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseServiceRoleKey: "server-only-key"
};

const context = {
  requestId: "request-report-12345678",
  idempotencyKey: "report-idempotency-1",
  receivedAt: "2026-07-16T12:00:00.000Z",
  installation: { id: "installation-a", nppCode: "NPP-A" },
  actor: { id: "service:npp-a:mcp-v1", type: "service", authentication: "proxy-token" }
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("session report snapshot is owned by the canonical RPC", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ id: "report-1", session_id: "session-1" });
  };

  const result = await createSessionReportSnapshot(
    { sessionId: "session-1", source: "close_session" },
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.id, "report-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_create_session_report_snapshot$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_session_id: "session-1",
    p_source: "close_session",
    p_context: {
      requestId: "request-report-12345678",
      idempotencyKey: "report-idempotency-1",
      receivedAt: "2026-07-16T12:00:00.000Z",
      installationId: "installation-a",
      nppCode: "NPP-A",
      actorId: "service:npp-a:mcp-v1",
      actorType: "service",
      actorAuthentication: "proxy-token"
    }
  });
});

test("AI result is saved through the atomic service-role RPC with foundation context", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ row: { id: "report-1" }, analyzedAt: "2026-07-16T12:30:00.000Z" });
  };

  const result = await saveSessionReportAiResult(
    {
      sessionId: "session-1",
      aiResult: { summary: "Ổn" },
      analyzedAt: "2026-07-16T12:30:00.000Z"
    },
    context,
    config,
    { fetchImpl }
  );

  assert.equal(result.row.id, "report-1");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mcp_idempotent_save_session_report_ai_result$/);
  const args = JSON.parse(calls[0].init.body);
  assert.equal(args.p_session_id, "session-1");
  assert.deepEqual(args.p_ai_result, { summary: "Ổn" });
  assert.equal(args.p_analyzed_at, "2026-07-16T12:30:00.000Z");
  assert.equal(args.p_context.requestId, "request-report-12345678");
  assert.equal(args.p_context.installationId, "installation-a");
  assert.equal(args.p_context.actorId, "service:npp-a:mcp-v1");
});

test("session report validation fails before provider access", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    throw new Error("provider_must_not_be_called");
  };

  await assert.rejects(
    createSessionReportSnapshot({}, context, config, { fetchImpl }),
    (error) => error.message === "session_id_required" && error.statusCode === 400
  );
  await assert.rejects(
    saveSessionReportAiResult({ sessionId: "session-1" }, context, config, { fetchImpl }),
    (error) => error.message === "ai_result_required" && error.statusCode === 400
  );
  await assert.rejects(
    saveSessionReportAiResult({ sessionId: "session-1", aiResult: [] }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_ai_result" && error.statusCode === 400
  );
  await assert.rejects(
    saveSessionReportAiResult({ sessionId: "session-1", aiResult: {}, analyzedAt: "bad-date" }, context, config, { fetchImpl }),
    (error) => error.message === "invalid_ai_analyzed_at" && error.statusCode === 400
  );

  assert.equal(providerCalls, 0);
});

test("provider business errors are normalized without leaking provider details", async () => {
  const fetchImpl = async () => jsonResponse({ message: "session_report_not_found" }, 400);

  await assert.rejects(
    saveSessionReportAiResult(
      { sessionId: "missing", aiResult: { summary: "none" } },
      context,
      config,
      { fetchImpl }
    ),
    (error) => error.code === "session_report_not_found" && error.statusCode === 404
  );
});
