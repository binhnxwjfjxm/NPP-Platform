import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { handleReportAnalysisApi } from "./report-analysis-api.js";

function request(body) { const stream = Readable.from([JSON.stringify(body)]); stream.method = "POST"; return stream; }
function context({ permissions = ["mcp.report.write"], key = "mcp.session-report.analyze-test" } = {}) {
  return { requestId: "req-test", receivedAt: "2026-09-29T00:00:00.000Z", idempotencyKey: key,
    installation: { id: "installation-1", nppCode: "NPP" },
    principal: { id: "employee-1", type: "workforce", employeeId: "employee-1", permissions, scopes: [] },
    auth: { authenticated: true } };
}
function persistence(rows) { return { withTransaction: async (callback) => callback({ query: async () => ({ rows }) }) }; }
const config = { reportAgent: { configured: true, analyzeUrl: "https://agent.example.com/analyze", token: "token-token-token-token-token-token", timeoutMs: 5000 } };

test("report analysis requires mcp.report.write before calling agent", async () => {
  let called = false;
  await assert.rejects(() => handleReportAnalysisApi(request({ sessionId: "session-1" }), new URL("https://mcp.example.com/api/mcp-session-report/analyze"), context({ permissions: [] }), config, {
    persistence: persistence([]), fetchImpl: async () => { called = true; throw new Error("must not call"); }, saveAiResult: async () => {}
  }), (error) => error.code === "permission_denied" && error.statusCode === 403);
  assert.equal(called, false);
});

test("report analysis requires an official snapshot", async () => {
  await assert.rejects(() => handleReportAnalysisApi(request({ sessionId: "session-1" }), new URL("https://mcp.example.com/api/mcp-session-report/analyze"), context(), config, {
    persistence: persistence([]), fetchImpl: async () => { throw new Error("must not call"); }, saveAiResult: async () => {}
  }), (error) => error.code === "session_report_snapshot_required" && error.statusCode === 409);
});

test("report analysis sends snapshot context and persists result with same request context", async () => {
  let saved = null;
  const ctx = context({ key: "mcp.session-report.analyze-stable-key" });
  const result = await handleReportAnalysisApi(request({ sessionId: "session-1" }), new URL("https://mcp.example.com/api/mcp-session-report/analyze"), ctx, config, {
    persistence: persistence([{ id: "snapshot-1", session_id: "session-1", schema_version: "mcp.session-report.snapshot.v2", ai_prompt_context: { route: "Tuyến A" }, customer_details: [{ customerName: "Điểm bán A" }] }]),
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, "Bearer " + config.reportAgent.token);
      const body = JSON.parse(init.body); assert.deepEqual(body.input, { route: "Tuyến A" }); assert.deepEqual(body.selected_items, [{ customerName: "Điểm bán A" }]);
      return new Response(JSON.stringify({ ok: true, source: "agent-test", result: { summary: "Phiên ổn", risks: ["Cần theo dõi tồn"] } }), { status: 200 });
    },
    saveAiResult: async (body, saveContext) => { saved = { body, saveContext }; }
  });
  assert.equal(result.statusCode, 200); assert.equal(result.payload.data.snapshotId, "snapshot-1"); assert.equal(result.payload.data.result.summary, "Phiên ổn");
  assert.equal(saved.saveContext.idempotencyKey, "mcp.session-report.analyze-stable-key"); assert.equal(saved.body.sessionId, "session-1"); assert.equal(saved.body.aiResult.result.summary, "Phiên ổn");
});
