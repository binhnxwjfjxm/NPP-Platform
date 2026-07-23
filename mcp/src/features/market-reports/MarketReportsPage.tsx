import { restRows } from "@/lib/export/supabase-rest";
import type {
  CountItem,
  MarketReportItem,
  MarketReportKpi,
  MarketReportStatus,
  SessionReportCustomer,
  SessionReportHealth,
  SessionReportInsights,
  SessionReportOverview,
  SessionReportRecommendedAction,
  SessionReportSections
} from "./market-reports.types";
import { MarketReportsClientPage } from "./MarketReportsClientPage";
import { businessOwner, businessText } from "@/lib/ui/business-text";

type ReportRow = Record<string, unknown>;
type RawSections = Partial<SessionReportSections> & Record<string, unknown>;

const EMPTY_OVERVIEW: SessionReportOverview = {
  planned: 0,
  visited: 0,
  pending: 0,
  skipped: 0,
  observations: 0,
  orders: 0,
  tests: 0,
  followups: 0
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function num(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => businessText(item)).filter(Boolean) : [];
}

function countList(value: unknown): CountItem[] {
  return Array.isArray(value)
    ? value.map((item) => {
        const row = object(item);
        return { label: businessText(row.label), count: num(row.count) };
      }).filter((item) => item.label)
    : [];
}

function detailList<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.map((item) => object(item) as T) : [];
}

function rawSections(row: ReportRow): RawSections {
  const value = row.sections;
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawSections : {};
}

function overview(row: ReportRow): SessionReportOverview {
  const fromRow = object(row.overview);
  const fromSections = object(rawSections(row).overview);
  const merged = { ...EMPTY_OVERVIEW, ...fromSections, ...fromRow };
  return {
    planned: num(merged.planned),
    visited: num(merged.visited),
    pending: num(merged.pending),
    skipped: num(merged.skipped),
    observations: num(merged.observations),
    orders: num(merged.orders),
    tests: num(merged.tests),
    followups: num(merged.followups)
  };
}

function sections(row: ReportRow): SessionReportSections {
  const data = rawSections(row);
  return {
    overview: overview(row),
    competitors: countList(data.competitors),
    usedProducts: countList(data.usedProducts),
    opportunities: stringList(data.opportunities),
    risks: stringList(data.risks),
    nextActions: stringList(data.nextActions),
    observations: detailList(data.observations),
    orders: detailList(data.orders),
    tests: detailList(data.tests),
    followups: detailList(data.followups),
    skipped: detailList(data.skipped),
    customers: detailList<SessionReportCustomer>(row.customer_details)
  };
}

function insights(row: ReportRow): SessionReportInsights {
  const data = object(row.insights);
  const quality = object(data.dataQuality);
  return {
    summary: businessText(data.summary),
    reasons: stringList(data.reasons),
    opportunities: stringList(data.opportunities),
    risks: stringList(data.risks),
    dataQuality: Object.keys(quality).length ? {
      customerDetails: num(quality.customerDetails),
      expectedCustomers: num(quality.expectedCustomers),
      completeCustomerCoverage: Boolean(quality.completeCustomerCoverage),
      customersWithSignals: num(quality.customersWithSignals),
      visitedWithoutSignals: num(quality.visitedWithoutSignals)
    } : undefined
  };
}

function health(row: ReportRow): SessionReportHealth {
  const value = text(row.health);
  return value === "good" || value === "watch" || value === "risk" ? value : "unknown";
}

function statusFromHealth(value: SessionReportHealth): MarketReportStatus {
  if (value === "risk") return "risk";
  if (value === "good") return "opportunity";
  return "normal";
}

function firstLabel(items?: CountItem[]) {
  return Array.isArray(items) && items.length ? text(items[0]?.label) : "";
}

function recommendedActions(row: ReportRow): SessionReportRecommendedAction[] {
  return detailList<SessionReportRecommendedAction>(row.recommended_actions).map((item) => ({
    ...item,
    customerName: businessText(item.customerName),
    action: businessText(item.action),
    reason: businessText(item.reason)
  }));
}

function toItem(row: ReportRow): MarketReportItem {
  const data = sections(row);
  const storedInsights = insights(row);
  const storedHealth = health(row);
  const actions = recommendedActions(row);
  const firstAction = actions.find((item) => text(item.action));
  return {
    id: text(row.id),
    sessionId: text(row.session_id),
    routeId: text(row.route_id),
    date: text(row.session_date || row.snapshot_at).slice(0, 10),
    routeName: text(row.route_name) || "-",
    sales: businessOwner(row.sales),
    accountName: businessOwner(row.sales),
    reportType: "competitor",
    subject: `Báo cáo phiên · ${text(row.route_name) || "MCP"}`,
    competitorName: firstLabel(data.competitors),
    note: storedInsights.summary || businessText(row.summary_text) || "Báo cáo chưa có nhận định.",
    nextAction: businessText(firstAction?.action, "Theo dõi phiên sau"),
    status: statusFromHealth(storedHealth),
    snapshotSource: text(row.snapshot_source),
    snapshotAt: text(row.snapshot_at),
    schemaVersion: text(row.schema_version),
    score: num(row.score),
    health: storedHealth,
    warnings: stringList(row.warnings),
    recommendedActions: actions,
    insights: storedInsights,
    aiPromptContext: object(row.ai_prompt_context),
    aiResult: Object.keys(object(row.ai_result)).length ? object(row.ai_result) : null,
    aiAnalyzedAt: text(row.ai_analyzed_at),
    overview: data.overview,
    sections: data
  };
}

function kpis(reports: MarketReportItem[]): MarketReportKpi[] {
  const good = reports.filter((item) => item.health === "good").length;
  const risks = reports.filter((item) => item.health === "risk").length;
  const routeCount = new Set(reports.map((item) => item.routeName).filter(Boolean)).size;
  const complete = reports.filter((item) => item.insights.dataQuality?.completeCustomerCoverage).length;
  return [
    { label: "Báo cáo phiên", value: reports.length, hint: "Các phiên đã chốt" },
    { label: "Tốt / Cần xử lý", value: `${good}/${risks}`, hint: "Theo mức đánh giá đã lưu" },
    { label: "Đủ điểm bán", value: `${complete}/${reports.length}`, hint: "Có đầy đủ chi tiết điểm bán" },
    { label: "Tuyến", value: routeCount, hint: "Có báo cáo phiên" }
  ];
}

export async function MarketReportsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const rows = await restRows<ReportRow>("mcp_session_reports", {
    select: "id,session_id,route_id,route_name,session_date,sales,status,schema_version,kpis,overview,sections,customer_details,insights,score,health,warnings,recommended_actions,ai_prompt_context,ai_result,ai_analyzed_at,summary_text,snapshot_source,snapshot_at,created_at,updated_at",
    order: "session_date.desc,snapshot_at.desc",
    limit: 500
  });
  const reports = rows.map(toItem);
  const focusSessionId = text(searchParams?.sessionId || searchParams?.session_id || "");
  return <MarketReportsClientPage kpis={kpis(reports)} reports={reports} focusSessionId={focusSessionId} />;
}
