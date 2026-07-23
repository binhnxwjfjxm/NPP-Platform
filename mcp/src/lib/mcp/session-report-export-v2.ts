import {
  reportDate,
  reportFilename,
  reportMoney,
  reportPriority,
  reportStatus
} from "@/lib/export/business-report";
import type { SessionReportSource } from "@/lib/mcp/session-report-source";

export type SessionReportExportPayload = {
  schemaVersion: string;
  reportType: "mcp_session_report";
  language: "vi";
  generatedAt: string;
  source: {
    app: "MCP-Plan";
    origin: "snapshot" | "live";
    snapshotId?: string;
    snapshotSource?: string;
    snapshotAt?: string;
  };
  session: SessionReportSource["summary"]["session"];
  overview: SessionReportSource["summary"]["sections"]["overview"];
  score: number;
  health: SessionReportSource["health"];
  insights: SessionReportSource["insights"];
  warnings: string[];
  recommendedActions: SessionReportSource["recommendedActions"];
  customerDetails: SessionReportSource["customerDetails"];
  market: {
    competitors: SessionReportSource["summary"]["sections"]["competitors"];
    usedProducts: SessionReportSource["summary"]["sections"]["usedProducts"];
    observations: SessionReportSource["summary"]["sections"]["observations"];
  };
  commerce: {
    orders: SessionReportSource["summary"]["sections"]["orders"];
    tests: SessionReportSource["summary"]["sections"]["tests"];
  };
  followups: SessionReportSource["summary"]["sections"]["followups"];
  aiPromptContext: Record<string, unknown>;
  aiResult?: Record<string, unknown> | null;
  aiAnalyzedAt?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function percent(done: number, total: number) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function list(items: string[], empty: string) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function countList(items: Array<{ label: string; count: number }>, empty: string) {
  return items.length ? items.map((item) => `- ${item.label}: ${item.count}`).join("\n") : `- ${empty}`;
}

export function buildSessionReportExportPayload(source: SessionReportSource): SessionReportExportPayload {
  const summary = source.summary;
  return {
    schemaVersion: source.schemaVersion || "mcp.session-report.snapshot.v2",
    reportType: "mcp_session_report",
    language: "vi",
    generatedAt: new Date().toISOString(),
    source: {
      app: "MCP-Plan",
      origin: source.origin,
      snapshotId: source.snapshotId,
      snapshotSource: source.snapshotSource,
      snapshotAt: source.snapshotAt
    },
    session: summary.session,
    overview: summary.sections.overview,
    score: source.score,
    health: source.health,
    insights: source.insights,
    warnings: source.warnings,
    recommendedActions: source.recommendedActions,
    customerDetails: source.customerDetails,
    market: {
      competitors: summary.sections.competitors,
      usedProducts: summary.sections.usedProducts,
      observations: summary.sections.observations
    },
    commerce: {
      orders: summary.sections.orders,
      tests: summary.sections.tests
    },
    followups: summary.sections.followups,
    aiPromptContext: source.aiPromptContext,
    aiResult: source.aiResult,
    aiAnalyzedAt: source.aiAnalyzedAt
  };
}

export function buildSessionReportMarkdownV2(payload: SessionReportExportPayload) {
  const orders = payload.commerce.orders.length
    ? payload.commerce.orders.map((item) => `- ${item.customerName || "Khách chưa tên"} · ${item.code || item.id} · ${reportStatus(item.status)} · ${reportMoney(item.total)}${item.note ? ` · ${item.note}` : ""}`).join("\n")
    : "- Phiên này chưa phát sinh đơn hàng.";
  const tests = payload.commerce.tests.length
    ? payload.commerce.tests.map((item) => `- ${item.customerName || "Khách chưa tên"} · ${item.productName || "Sản phẩm chưa đặt tên"} · ${reportStatus(item.status)}${item.note ? ` · ${item.note}` : ""}`).join("\n")
    : "- Phiên này chưa có kết quả thử sản phẩm.";
  const observations = payload.market.observations.length
    ? payload.market.observations.map((item) => `- ${item.customerName || "Khách chưa tên"}: ${item.note || "Chưa có ghi chú"}`).join("\n")
    : "- Chưa có ghi nhận thị trường.";
  const followups = payload.followups.length
    ? payload.followups.map((item) => `- ${reportPriority(item.priority)} · ${item.customerName || "Khách chưa tên"} · ${item.title || "Việc cần làm"}${item.dueDate ? ` · Hẹn ${reportDate(item.dueDate)}` : ""} · ${reportStatus(item.status)}${item.note ? ` · ${item.note}` : ""}`).join("\n")
    : "- Chưa có việc cần theo dõi.";
  const customers = payload.customerDetails.length
    ? payload.customerDetails.map((item) => `- ${item.sortOrder || "-"}. ${item.customerName} · ${reportStatus(item.visitStatus)}${item.statusReason ? ` · ${item.statusReason}` : ""} · ${item.orders.length} đơn · ${item.tests.length} lượt thử · ${item.followups.length} việc theo dõi`).join("\n")
    : "- Chưa có chi tiết điểm bán.";
  const actions = payload.recommendedActions.length
    ? payload.recommendedActions.map((item) => `- ${reportPriority(item.priority)}${item.customerName ? ` · ${item.customerName}` : ""}: ${item.action}${item.reason ? ` — ${item.reason}` : ""}`).join("\n")
    : "- Chưa có việc cần thực hiện thêm.";

  return [
    "# Báo cáo kết quả phiên bán hàng",
    "",
    `**Tuyến:** ${payload.session.routeName || "Tuyến chưa đặt tên"}`,
    `**Ngày phiên:** ${reportDate(payload.session.sessionDate)}`,
    `**Nhân viên phụ trách:** ${payload.session.sales || "Chưa phân công"}`,
    `**Trạng thái phiên:** ${reportStatus(payload.session.status)}`,
    "",
    "## Kết quả chính",
    "",
    `- Điểm bán kế hoạch: **${payload.overview.planned}**`,
    `- Đã ghé: **${payload.overview.visited}** (${percent(payload.overview.visited, payload.overview.planned)}%)`,
    `- Chờ ghé: **${payload.overview.pending}**`,
    `- Bỏ qua: **${payload.overview.skipped}**`,
    `- Đơn hàng: **${payload.overview.orders}**`,
    `- Lượt thử sản phẩm: **${payload.overview.tests}**`,
    `- Ghi nhận thị trường: **${payload.overview.observations}**`,
    `- Việc cần theo dõi: **${payload.overview.followups}**`,
    "",
    "## Nhận định chung",
    "",
    payload.insights.summary || "Chưa có nhận định tổng hợp cho phiên này.",
    "",
    "## Cảnh báo cần chú ý",
    "",
    list(payload.warnings, "Không có cảnh báo nổi bật."),
    "",
    "## Cơ hội bán hàng",
    "",
    list(payload.insights.opportunities || [], "Chưa ghi nhận cơ hội rõ ràng."),
    "",
    "## Rủi ro",
    "",
    list(payload.insights.risks || [], "Chưa ghi nhận rủi ro nổi bật."),
    "",
    "## Việc nên thực hiện tiếp theo",
    "",
    actions,
    "",
    "## Đơn hàng phát sinh",
    "",
    orders,
    "",
    "## Kết quả thử sản phẩm",
    "",
    tests,
    "",
    "## Ghi nhận thị trường",
    "",
    "### Đối thủ được ghi nhận",
    countList(payload.market.competitors, "Chưa ghi nhận đối thủ."),
    "",
    "### Sản phẩm khách đang sử dụng",
    countList(payload.market.usedProducts, "Chưa ghi nhận sản phẩm khách đang sử dụng."),
    "",
    "### Ghi nhận chi tiết",
    observations,
    "",
    "## Việc cần theo dõi",
    "",
    followups,
    "",
    `## Chi tiết điểm bán (${payload.customerDetails.length}/${payload.overview.planned})`,
    "",
    customers,
    "",
    `Báo cáo được lập ngày ${reportDate(payload.generatedAt)}.`
  ].join("\n");
}

export function sessionReportExportFilenameV2(payload: SessionReportExportPayload, extension: "json" | "md") {
  return reportFilename("bao-cao-phien-ban-hang", [payload.session.routeName, payload.session.sessionDate], extension);
}
