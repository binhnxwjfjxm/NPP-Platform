import { restRows } from "@/lib/export/supabase-rest";
import { buildSessionReportCustomerDetails, type SessionReportCustomerDetail } from "@/lib/mcp/session-report-customer-details";
import { buildSessionReportEnrichment, type SessionReportEnrichment, type SessionReportHealth, type SessionReportRecommendedAction } from "@/lib/mcp/session-report-enrichment";
import { buildMcpSessionReportSummary, type SessionReportSummary } from "@/lib/mcp/session-report";

type Row = Record<string, unknown>;

export type SessionReportSource = {
  summary: SessionReportSummary;
  origin: "snapshot" | "live";
  snapshotId?: string;
  snapshotSource?: string;
  snapshotAt?: string;
  schemaVersion: string;
  customerDetails: SessionReportCustomerDetail[];
  insights: SessionReportEnrichment["insights"];
  score: number;
  health: SessionReportHealth;
  warnings: string[];
  recommendedActions: SessionReportRecommendedAction[];
  aiPromptContext: Record<string, unknown>;
  aiResult?: Record<string, unknown> | null;
  aiAnalyzedAt?: string;
};

const EMPTY_INSIGHTS: SessionReportEnrichment["insights"] = {
  summary: "",
  reasons: [],
  opportunities: [],
  risks: [],
  dataQuality: {
    customerDetails: 0,
    expectedCustomers: 0,
    completeCustomerCoverage: false,
    customersWithSignals: 0,
    visitedWithoutSignals: 0
  }
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function num(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function object(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function healthValue(value: unknown): SessionReportHealth {
  const normalized = text(value);
  return normalized === "good" || normalized === "watch" || normalized === "risk" ? normalized : "risk";
}

function insightsValue(value: unknown): SessionReportEnrichment["insights"] {
  const row = object(value);
  if (!row) return EMPTY_INSIGHTS;
  const quality = object(row.dataQuality);
  return {
    summary: text(row.summary),
    reasons: array<string>(row.reasons),
    opportunities: array<string>(row.opportunities),
    risks: array<string>(row.risks),
    dataQuality: {
      customerDetails: num(quality?.customerDetails),
      expectedCustomers: num(quality?.expectedCustomers),
      completeCustomerCoverage: Boolean(quality?.completeCustomerCoverage),
      customersWithSignals: num(quality?.customersWithSignals),
      visitedWithoutSignals: num(quality?.visitedWithoutSignals)
    }
  };
}

function summaryFromSnapshot(row: Row): SessionReportSummary | null {
  const rawPayload = object(row.raw_payload);
  const rawSummary = object(rawPayload?.summary);
  if (rawSummary?.session && rawSummary?.sections && Array.isArray(rawSummary?.kpis)) {
    return rawSummary as unknown as SessionReportSummary;
  }

  const sections = object(row.sections);
  const kpis = Array.isArray(row.kpis) ? row.kpis : [];
  if (!sections) return null;

  return {
    session: {
      id: text(row.session_id),
      routeId: text(row.route_id),
      routeName: text(row.route_name),
      sessionDate: text(row.session_date).slice(0, 10),
      sales: text(row.sales),
      status: "done",
      updatedAt: text(row.snapshot_at || row.updated_at)
    },
    kpis: kpis as SessionReportSummary["kpis"],
    sections: sections as unknown as SessionReportSummary["sections"]
  };
}

export async function loadMcpSessionReportSource(input: { sessionId?: string; routeId?: string; date?: string }): Promise<SessionReportSource> {
  const sessionId = text(input.sessionId);
  if (sessionId) {
    const rows = await restRows<Row>("mcp_session_reports", {
      select: "id,session_id,route_id,route_name,session_date,sales,status,schema_version,kpis,overview,sections,customer_details,insights,score,health,warnings,recommended_actions,ai_prompt_context,ai_result,ai_analyzed_at,summary_text,snapshot_source,snapshot_at,raw_payload,created_at,updated_at",
      order: "snapshot_at.desc,updated_at.desc",
      limit: 1,
      filters: { session_id: sessionId }
    });
    const row = rows[0];
    const summary = row ? summaryFromSnapshot(row) : null;
    if (row && summary) {
      return {
        summary,
        origin: "snapshot",
        snapshotId: text(row.id),
        snapshotSource: text(row.snapshot_source),
        snapshotAt: text(row.snapshot_at || row.updated_at),
        schemaVersion: text(row.schema_version) || "mcp.session-report.snapshot.v2",
        customerDetails: array<SessionReportCustomerDetail>(row.customer_details),
        insights: insightsValue(row.insights),
        score: num(row.score),
        health: healthValue(row.health),
        warnings: array<string>(row.warnings),
        recommendedActions: array<SessionReportRecommendedAction>(row.recommended_actions),
        aiPromptContext: object(row.ai_prompt_context) || {},
        aiResult: object(row.ai_result),
        aiAnalyzedAt: text(row.ai_analyzed_at)
      };
    }
  }

  const summary = await buildMcpSessionReportSummary(input);
  const customerDetails = await buildSessionReportCustomerDetails(summary);
  const enrichment = buildSessionReportEnrichment(summary, customerDetails);
  return {
    summary,
    origin: "live",
    schemaVersion: enrichment.schemaVersion,
    customerDetails,
    insights: enrichment.insights,
    score: enrichment.score,
    health: enrichment.health,
    warnings: enrichment.warnings,
    recommendedActions: enrichment.recommendedActions,
    aiPromptContext: enrichment.aiPromptContext,
    aiResult: null,
    aiAnalyzedAt: ""
  };
}
