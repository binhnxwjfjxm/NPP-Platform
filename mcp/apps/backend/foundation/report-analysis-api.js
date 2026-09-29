import { requirePermission } from "./authorization.js";
import { saveSessionReportAiResult } from "./session-report-mutations.js";

const ANALYZE_PATH = "/api/mcp-session-report/analyze";
const MAX_BODY_BYTES = 256 * 1024;

function text(value) { return String(value ?? "").trim(); }
function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function list(value) { return Array.isArray(value) ? value : []; }
function apiError(code, statusCode = 400, publicRetryable = false, publicDetails = {}) {
  const error = new Error(code); error.code = code; error.statusCode = statusCode; error.publicRetryable = publicRetryable; error.publicDetails = publicDetails; return error;
}
async function readJsonBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw apiError("request_body_too_large", 413);
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try { return object(JSON.parse(raw)); } catch { throw apiError("invalid_json_body", 400); }
}
function extractResult(payload) {
  const candidate = payload.result ?? payload.output ?? payload.analysis ?? payload.response ?? payload.answer ?? payload.content ?? payload;
  if (typeof candidate === "string") { try { return object(JSON.parse(candidate)); } catch { return { summary: candidate }; } }
  return object(candidate);
}
function normalizeResult(value) {
  const result = object(value);
  return {
    summary: text(result.summary || result.answer || result.text),
    market_insights: list(result.market_insights), product_insights: list(result.product_insights),
    customer_actions: list(result.customer_actions), sample_requests: list(result.sample_requests),
    follow_up_list: list(result.follow_up_list), order_opportunities: list(result.order_opportunities),
    risks: list(result.risks), next_steps: list(result.next_steps)
  };
}
async function loadSnapshot(persistence, installationId, sessionId) {
  return persistence.withTransaction(async (client) => {
    const sql = "SELECT id, session_id, schema_version, ai_prompt_context, customer_details " +
      "FROM mcp.mcp_session_reports WHERE installation_id = $1 AND session_id = $2 " +
      "ORDER BY snapshot_at DESC NULLS LAST, updated_at DESC, id DESC LIMIT 1";
    const result = await client.query(sql, [installationId, sessionId]);
    return result.rows?.[0] || null;
  });
}
async function callAgent(config, snapshot, fetchImpl) {
  const agent = config.reportAgent;
  if (!agent?.configured || !agent.analyzeUrl) throw apiError("report_agent_not_configured", 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), agent.timeoutMs || 55000);
  try {
    const headers = { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" };
    if (agent.token) headers.Authorization = "Bearer " + agent.token;
    const response = await fetchImpl(agent.analyzeUrl, {
      method: "POST", headers, signal: controller.signal,
      body: JSON.stringify({
        input: object(snapshot.ai_prompt_context), snapshot: object(snapshot.ai_prompt_context),
        report_type: "mcp_session_report", selected_items: list(snapshot.customer_details),
        selected_only: true, task: "mcp_session_report_analysis"
      })
    });
    const rawText = await response.text();
    let payload = {};
    try { payload = object(JSON.parse(rawText)); } catch { payload = { content: rawText }; }
    const result = normalizeResult(extractResult(payload));
    if (!response.ok || payload.ok === false) throw apiError("report_agent_rejected", 502, true, { upstreamStatus: response.status, result });
    return { source: text(payload.source) || "mcp_report_agent", status: response.status, result };
  } catch (error) {
    if (error?.name === "AbortError") throw apiError("report_agent_timeout", 504, true);
    if (error?.statusCode) throw error;
    throw apiError("report_agent_unavailable", 503, true);
  } finally { clearTimeout(timer); }
}
export async function handleReportAnalysisApi(req, url, context, config, { persistence, fetchImpl = globalThis.fetch, saveAiResult = saveSessionReportAiResult } = {}) {
  if (url.pathname !== ANALYZE_PATH) return null;
  if (String(req.method || "GET").toUpperCase() !== "POST") throw apiError("method_not_allowed", 405);
  requirePermission(context, "mcp.report.write");
  if (!text(context?.idempotencyKey)) throw apiError("idempotency_key_required", 400);
  if (!persistence?.withTransaction) throw apiError("provider_unavailable", 503, true);
  const body = await readJsonBody(req);
  const sessionId = text(body.sessionId || body.session_id);
  if (!sessionId) throw apiError("session_id_required", 400);
  const snapshot = await loadSnapshot(persistence, context.installation.id, sessionId);
  if (!snapshot) throw apiError("session_report_snapshot_required", 409, false, { sessionId });
  const analyzed = await callAgent(config, snapshot, fetchImpl);
  const analyzedAt = new Date().toISOString();
  const aiResult = { schemaVersion: "mcp.session-report.ai-result.v1", source: analyzed.source, status: analyzed.status, result: analyzed.result, generatedAt: analyzedAt };
  await saveAiResult({ sessionId, aiResult, analyzedAt }, context, config, { fetchImpl });
  return { statusCode: 200, payload: { data: { source: analyzed.source, status: analyzed.status, result: analyzed.result, reportSource: "snapshot", snapshotId: text(snapshot.id), persisted: true, aiAnalyzedAt: analyzedAt } } };
}
export const reportAnalysisApiInternals = Object.freeze({ ANALYZE_PATH, normalizeResult });
