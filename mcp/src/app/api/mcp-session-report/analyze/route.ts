import {
  apiErrorResponse,
  apiFailureFromPayload,
  apiSuccessResponse,
  normalizeApiRequestId
} from "@/lib/api/api-contract";
import { backendApiBaseUrl, backendApiRequestHeaders } from "@/lib/api/backend-proxy";
import { mcpReportAgentHealthUrl, mcpReportAgentUrl } from "@/lib/mcp/report-agent-config";
import { buildSessionReportExportPayload } from "@/lib/mcp/session-report-export-v2";
import { loadMcpSessionReportSource } from "@/lib/mcp/session-report-source";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AgentResult = {
  summary: string;
  market_insights: unknown[];
  product_insights: unknown[];
  customer_actions: unknown[];
  sample_requests: unknown[];
  follow_up_list: unknown[];
  order_opportunities: unknown[];
  risks: unknown[];
  next_steps: unknown[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { content: value };
  }
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function fallbackResult(reason: string): AgentResult {
  return {
    summary: reason,
    market_insights: [],
    product_insights: [],
    customer_actions: [],
    sample_requests: [],
    follow_up_list: [],
    order_opportunities: [],
    risks: [reason],
    next_steps: ["Kiểm tra cấu hình và log MCP Report Agent."]
  };
}

function extractResult(payload: Record<string, unknown>) {
  const candidate =
    payload.result ||
    payload.output ||
    payload.analysis ||
    payload.response ||
    payload.answer ||
    payload.content ||
    payload;

  if (typeof candidate === "string") {
    const parsed = parseJson(candidate);
    return typeof parsed === "object" && parsed
      ? (parsed as Record<string, unknown>)
      : { summary: candidate };
  }

  return object(candidate);
}

function normalizeResult(value: unknown): AgentResult {
  const result = object(value);
  return {
    summary: text(result.summary || result.answer || result.text),
    market_insights: list(result.market_insights),
    product_insights: list(result.product_insights),
    customer_actions: list(result.customer_actions),
    sample_requests: list(result.sample_requests),
    follow_up_list: list(result.follow_up_list),
    order_opportunities: list(result.order_opportunities),
    risks: list(result.risks),
    next_steps: list(result.next_steps)
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 55000
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store"
    });
  } finally {
    clearTimeout(timer);
  }
}

async function persistAgentResult(
  sessionId: string,
  aiResult: Record<string, unknown>,
  requestId: string,
  idempotencyKey: string
) {
  const analyzedAt = new Date().toISOString();
  const { headers } = backendApiRequestHeaders(undefined, {
    requestId,
    hasBody: true,
    contentType: "application/json",
    idempotencyKey
  });
  const response = await fetch(
    `${backendApiBaseUrl()}/api/mcp-session-report/ai-result`,
    {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify({ sessionId, aiResult, analyzedAt })
    }
  );

  const payload = object(await response.json().catch(() => ({})));
  if (!response.ok) {
    const failure = apiFailureFromPayload(payload);
    throw new Error(failure.code || "save_ai_result_failed");
  }

  const data = object(payload.data);
  return {
    row: data.row,
    analyzedAt: text(data.analyzedAt) || analyzedAt
  };
}

export async function GET(request: Request) {
  const requestId = normalizeApiRequestId(request.headers.get("x-request-id"));

  try {
    const response = await fetchWithTimeout(
      mcpReportAgentHealthUrl(),
      {
        method: "GET",
        headers: { Accept: "application/json" }
      },
      15000
    );

    const rawText = await response.text();
    const health = object(parseJson(rawText));
    const available = response.ok && health.ok !== false;

    if (!available) {
      return apiErrorResponse("REPORT_AGENT_UNAVAILABLE", {
        requestId,
        status: 503,
        retryable: true,
        details: {
          source: "mcp_report_agent_health",
          upstreamStatus: response.status
        }
      });
    }

    return apiSuccessResponse(
      {
        available: true,
        status: response.status,
        source: "mcp_report_agent_health"
      },
      { requestId }
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return apiErrorResponse(
      timedOut ? "REPORT_AGENT_TIMEOUT" : "REPORT_AGENT_UNAVAILABLE",
      {
        requestId,
        status: timedOut ? 504 : 503,
        retryable: true
      }
    );
  }
}

export async function POST(request: Request) {
  const requestId = normalizeApiRequestId(request.headers.get("x-request-id"));
  const idempotencyKey = text(request.headers.get("idempotency-key"));
  let body: Record<string, unknown>;

  try {
    body = object(await request.json());
  } catch {
    return apiErrorResponse("INVALID_JSON_BODY", {
      requestId,
      status: 400,
      message: "Nội dung JSON không hợp lệ."
    });
  }

  if (!idempotencyKey) {
    return apiErrorResponse("IDEMPOTENCY_KEY_REQUIRED", {
      requestId,
      status: 400
    });
  }

  const sessionId = text(body.sessionId || body.session_id);
  if (!sessionId) {
    return apiErrorResponse("SESSION_ID_REQUIRED", {
      requestId,
      status: 400,
      details: {
        result: fallbackResult("Thiếu sessionId để phân tích BC phiên.")
      }
    });
  }

  try {
    const source = await loadMcpSessionReportSource({ sessionId });
    if (source.origin !== "snapshot" || !source.snapshotId) {
      return apiErrorResponse("SESSION_REPORT_SNAPSHOT_REQUIRED", {
        requestId,
        status: 409,
        details: {
          source: "missing_snapshot",
          reportSource: source.origin,
          result: fallbackResult(
            "BC phiên chưa có snapshot chính thức. Hãy rebuild BC trước khi chạy AI."
          )
        }
      });
    }

    const snapshot = buildSessionReportExportPayload(source);
    const agentUrl = mcpReportAgentUrl();
    const token = text(process.env.MCP_REPORT_AGENT_TOKEN);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8"
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetchWithTimeout(agentUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        input: source.aiPromptContext,
        snapshot: source.aiPromptContext,
        report_type: snapshot.reportType,
        selected_items: source.customerDetails,
        selected_only: true,
        task: "mcp_session_report_analysis"
      })
    });

    const responseText = await response.text();
    const raw = object(parseJson(responseText));
    const result = normalizeResult(extractResult(raw));
    const agentOk = response.ok && raw.ok !== false;
    const agentSource = text(raw.source) || "mcp_report_agent";

    if (!agentOk) {
      return apiErrorResponse("REPORT_AGENT_REJECTED", {
        requestId,
        status: 502,
        retryable: true,
        details: {
          source: agentSource,
          upstreamStatus: response.status,
          result,
          reportSource: source.origin,
          snapshotId: source.snapshotId,
          persisted: false
        }
      });
    }

    const saved = await persistAgentResult(
      sessionId,
      {
        schemaVersion: "mcp.session-report.ai-result.v1",
        source: agentSource,
        status: response.status,
        result,
        generatedAt: new Date().toISOString()
      },
      requestId,
      idempotencyKey
    );

    return apiSuccessResponse(
      {
        source: agentSource,
        status: response.status,
        result,
        reportSource: source.origin,
        snapshotId: source.snapshotId,
        persisted: true,
        aiAnalyzedAt: saved.analyzedAt
      },
      { requestId }
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return apiErrorResponse(
      timedOut ? "REPORT_AGENT_TIMEOUT" : "REPORT_ANALYSIS_FAILED",
      {
        requestId,
        status: timedOut ? 504 : 500,
        retryable: timedOut,
        details: {
          source: "mcp_report_agent_exception",
          result: fallbackResult(
            timedOut
              ? "Agent phân tích quá thời gian chờ."
              : "Không thể hoàn tất phân tích báo cáo."
          )
        }
      }
    );
  }
}
