import type { SessionReportSummary } from "@/lib/mcp/session-report";
import type { SessionReportSource } from "@/lib/mcp/session-report-source";

type CustomerSignal = {
  customerName: string;
  visitStatus?: string;
  orders: Array<{ id: string; code: string; status: string; total: number; note: string }>;
  tests: Array<{ id: string; productName: string; status: string; note: string }>;
  observations: Array<{ id: string; competitors: string[]; usedProducts: string[]; note: string }>;
  followups: Array<{ id: string; title: string; dueDate: string; status: string; priority: string; note: string }>;
  skipReason?: string;
};

export type SessionReportAiPayload = {
  schemaVersion: "mcp.session-report.ai.v1";
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
  session: SessionReportSummary["session"];
  overview: SessionReportSummary["sections"]["overview"];
  assessment: {
    status: "good" | "watch" | "risk";
    score: number;
    summary: string;
    reasons: string[];
  };
  insights: {
    opportunities: string[];
    risks: string[];
    nextActions: string[];
  };
  market: {
    competitors: SessionReportSummary["sections"]["competitors"];
    usedProducts: SessionReportSummary["sections"]["usedProducts"];
    observations: SessionReportSummary["sections"]["observations"];
  };
  commerce: {
    orders: SessionReportSummary["sections"]["orders"];
    tests: SessionReportSummary["sections"]["tests"];
  };
  followups: SessionReportSummary["sections"]["followups"];
  customers: {
    signals: CustomerSignal[];
    skipped: SessionReportSummary["sections"]["skipped"];
  };
  agentInput: {
    selected_only: true;
    report_type: "mcp_session_report";
    task: "mcp_session_report_analysis";
    instructions: string[];
  };
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function pct(done: number, total: number) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function customerSignals(summary: SessionReportSummary): CustomerSignal[] {
  const map = new Map<string, CustomerSignal>();
  const get = (customerName: string) => {
    const name = text(customerName) || "Khách trong phiên";
    if (!map.has(name)) {
      map.set(name, { customerName: name, orders: [], tests: [], observations: [], followups: [] });
    }
    return map.get(name)!;
  };

  summary.sections.orders.forEach((item) => {
    get(item.customerName).orders.push({ id: item.id, code: item.code, status: item.status, total: item.total, note: item.note });
  });
  summary.sections.tests.forEach((item) => {
    get(item.customerName).tests.push({ id: item.id, productName: item.productName, status: item.status, note: item.note });
  });
  summary.sections.observations.forEach((item) => {
    get(item.customerName).observations.push({ id: item.id, competitors: item.competitors, usedProducts: item.usedProducts, note: item.note });
  });
  summary.sections.followups.forEach((item) => {
    get(item.customerName).followups.push({ id: item.id, title: item.title, dueDate: item.dueDate, status: item.status, priority: item.priority, note: item.note });
  });
  summary.sections.skipped.forEach((item) => {
    const row = get(item.customerName);
    row.visitStatus = "skipped";
    row.skipReason = item.reason;
  });

  return Array.from(map.values()).sort((a, b) => a.customerName.localeCompare(b.customerName, "vi"));
}

function assessment(summary: SessionReportSummary) {
  const overview = summary.sections.overview;
  const visitRate = overview.planned > 0 ? overview.visited / overview.planned : 0;
  let score = 50;
  const reasons: string[] = [];
  const risks = [...summary.sections.risks];
  const opportunities = [...summary.sections.opportunities];
  const nextActions = [...summary.sections.nextActions];

  if (overview.planned > 0) {
    if (visitRate >= 0.7) {
      score += 20;
      reasons.push(`Độ phủ tốt: ${overview.visited}/${overview.planned} khách (${pct(overview.visited, overview.planned)}%).`);
    } else if (visitRate >= 0.35) {
      score += 5;
      reasons.push(`Độ phủ trung bình: ${overview.visited}/${overview.planned} khách (${pct(overview.visited, overview.planned)}%).`);
    } else {
      score -= 20;
      const reason = `Độ phủ thấp: ${overview.visited}/${overview.planned} khách (${pct(overview.visited, overview.planned)}%).`;
      reasons.push(reason);
      risks.unshift(reason);
      nextActions.unshift("Rà lại nhóm khách chưa ghé và lý do bỏ sót tuyến.");
    }
  }

  if (overview.orders > 0) {
    score += 10;
    const reason = `Có ${overview.orders} đơn phát sinh trong phiên.`;
    reasons.push(reason);
    opportunities.unshift(reason);
    nextActions.push("Kiểm tra trạng thái xử lý các đơn phát sinh sau phiên.");
  }
  if (overview.tests > 0) {
    score += 5;
    const reason = `Có ${overview.tests} test sản phẩm cần theo dõi.`;
    reasons.push(reason);
    opportunities.push(reason);
  }
  if (overview.observations > 0) {
    score += 5;
    reasons.push(`Có ${overview.observations} quan sát thị trường.`);
  }
  if (overview.followups > 0) {
    score += 5;
    reasons.push(`Có ${overview.followups} follow-up đã được ghi nhận.`);
  }
  if (overview.tests > 0 && overview.followups === 0) {
    score -= 10;
    const reason = "Có test sản phẩm nhưng chưa có follow-up đi kèm.";
    reasons.push(reason);
    risks.push(reason);
    nextActions.unshift("Tạo follow-up cho khách đã test để không mất tín hiệu mua hàng.");
  }
  if (overview.visited === 0 && overview.planned > 0) {
    score -= 10;
    reasons.push("Phiên chưa ghi nhận khách đã ghé.");
  }

  score = clamp(score, 0, 100);
  const status = score >= 70 ? "good" as const : score >= 45 ? "watch" as const : "risk" as const;
  const summaryText = status === "good"
    ? "Phiên có độ phủ và tín hiệu thương mại tốt; ưu tiên chuyển các phát sinh thành hành động cụ thể."
    : status === "watch"
      ? "Phiên có tín hiệu bán hàng hoặc test nhưng vẫn còn điểm cần theo dõi trước khi dùng làm báo cáo quản trị."
      : "Phiên có độ phủ hoặc dữ liệu hành động thấp; cần xử lý các khoảng trống trước khi kết luận hiệu quả tuyến.";

  return {
    assessment: { status, score, summary: summaryText, reasons: unique(reasons) },
    insights: {
      opportunities: unique(opportunities),
      risks: unique(risks),
      nextActions: unique(nextActions)
    }
  };
}

export function buildSessionReportAiPayload(source: SessionReportSource): SessionReportAiPayload {
  const summary = source.summary;
  const evaluated = assessment(summary);
  return {
    schemaVersion: "mcp.session-report.ai.v1",
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
    assessment: evaluated.assessment,
    insights: evaluated.insights,
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
    customers: {
      signals: customerSignals(summary),
      skipped: summary.sections.skipped
    },
    agentInput: {
      selected_only: true,
      report_type: "mcp_session_report",
      task: "mcp_session_report_analysis",
      instructions: [
        "Chỉ phân tích dữ liệu có trong payload; không bịa dữ liệu còn thiếu.",
        "Nêu rõ dữ liệu chưa đủ hoặc mâu thuẫn thay vì suy đoán.",
        "Ưu tiên nhận định về độ phủ tuyến, đơn hàng, test, quan sát và follow-up.",
        "Trả kết quả có cấu trúc để quản lý ra quyết định và lập kế hoạch phiên sau."
      ]
    }
  };
}

function markdownList(items: string[], empty: string) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`;
}

function countList(items: Array<{ label: string; count: number }>, empty: string) {
  return items.length ? items.map((item) => `- ${item.label}: ${item.count}`).join("\n") : `- ${empty}`;
}

export function buildSessionReportMarkdown(payload: SessionReportAiPayload) {
  const { session, overview, assessment: evaluation } = payload;
  const orders = payload.commerce.orders.length
    ? payload.commerce.orders.map((item) => `- ${item.customerName || "Khách"} · ${item.code || item.id} · ${item.status || "-"} · ${Math.round(item.total || 0).toLocaleString("vi-VN")}đ${item.note ? ` · ${item.note}` : ""}`).join("\n")
    : "- Chưa có đơn hàng.";
  const tests = payload.commerce.tests.length
    ? payload.commerce.tests.map((item) => `- ${item.customerName || "Khách"} · ${item.productName || "Sản phẩm"} · ${item.status || "-"}${item.note ? ` · ${item.note}` : ""}`).join("\n")
    : "- Chưa có test sản phẩm.";
  const observations = payload.market.observations.length
    ? payload.market.observations.map((item) => `- ${item.customerName || "Khách"}: ${item.note || "Không có ghi chú"}`).join("\n")
    : "- Chưa có quan sát thị trường.";
  const followups = payload.followups.length
    ? payload.followups.map((item) => `- [${item.priority || "medium"}] ${item.customerName || "Khách"} · ${item.title || "Follow-up"}${item.dueDate ? ` · ${item.dueDate}` : ""} · ${item.status || "open"}${item.note ? ` · ${item.note}` : ""}`).join("\n")
    : "- Chưa có follow-up.";

  return [
    `# BC phiên · ${session.routeName || "MCP"}`,
    "",
    `- **Ngày phiên:** ${session.sessionDate || "-"}`,
    `- **Sales:** ${session.sales || "-"}`,
    `- **Session ID:** ${session.id}`,
    `- **Nguồn:** ${payload.source.origin === "snapshot" ? "Snapshot đã chốt" : "Tổng hợp trực tiếp"}`,
    payload.source.snapshotAt ? `- **Snapshot lúc:** ${payload.source.snapshotAt}` : "",
    "",
    "## Tổng quan",
    "",
    `- Khách kế hoạch: **${overview.planned}**`,
    `- Đã ghé: **${overview.visited}** (${pct(overview.visited, overview.planned)}%)`,
    `- Chờ ghé: **${overview.pending}**`,
    `- Bỏ qua: **${overview.skipped}**`,
    `- Đơn/Test: **${overview.orders}/${overview.tests}**`,
    `- Quan sát/Follow-up: **${overview.observations}/${overview.followups}**`,
    "",
    "## Đánh giá có quy tắc",
    "",
    `- **Trạng thái:** ${evaluation.status}`,
    `- **Điểm:** ${evaluation.score}/100`,
    `- **Tóm tắt:** ${evaluation.summary}`,
    markdownList(evaluation.reasons, "Chưa có lý do đánh giá."),
    "",
    "## Cơ hội",
    "",
    markdownList(payload.insights.opportunities, "Chưa có cơ hội rõ."),
    "",
    "## Rủi ro",
    "",
    markdownList(payload.insights.risks, "Chưa có rủi ro rõ."),
    "",
    "## Việc tiếp theo",
    "",
    markdownList(payload.insights.nextActions, "Chưa có việc đề xuất."),
    "",
    "## Đơn hàng",
    "",
    orders,
    "",
    "## Test sản phẩm",
    "",
    tests,
    "",
    "## Quan sát thị trường",
    "",
    "### Đối thủ",
    countList(payload.market.competitors, "Chưa ghi nhận."),
    "",
    "### Sản phẩm khách đang dùng",
    countList(payload.market.usedProducts, "Chưa ghi nhận."),
    "",
    "### Chi tiết",
    observations,
    "",
    "## Follow-up",
    "",
    followups,
    "",
    "---",
    `Generated by MCP-Plan at ${payload.generatedAt}`
  ].filter((line) => line !== "").join("\n");
}

export function sessionReportExportFilename(payload: SessionReportAiPayload, extension: "json" | "md") {
  const route = text(payload.session.routeName || "mcp")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "mcp";
  return `bc-phien-${route}-${payload.session.sessionDate || "khong-ngay"}.${extension}`;
}
