import type { SessionReportSummary } from "@/lib/mcp/session-report";
import type { SessionReportCustomerDetail } from "@/lib/mcp/session-report-customer-details";

export type SessionReportHealth = "good" | "watch" | "risk";

export type SessionReportRecommendedAction = {
  type: "route_coverage" | "test_followup" | "order_followup" | "customer_followup" | "data_quality";
  priority: "high" | "medium" | "low";
  customerId?: string;
  customerName?: string;
  action: string;
  reason: string;
};

export type SessionReportEnrichment = {
  schemaVersion: "mcp.session-report.snapshot.v2";
  customerDetails: SessionReportCustomerDetail[];
  insights: {
    summary: string;
    reasons: string[];
    opportunities: string[];
    risks: string[];
    dataQuality: {
      customerDetails: number;
      expectedCustomers: number;
      completeCustomerCoverage: boolean;
      customersWithSignals: number;
      visitedWithoutSignals: number;
    };
  };
  score: number;
  health: SessionReportHealth;
  warnings: string[];
  recommendedActions: SessionReportRecommendedAction[];
  aiPromptContext: Record<string, unknown>;
};

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function percent(done: number, total: number) {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function hasSignal(customer: SessionReportCustomerDetail) {
  return customer.orders.length > 0
    || customer.tests.length > 0
    || customer.observations.length > 0
    || customer.followups.length > 0
    || customer.followupCount > 0
    || Boolean(customer.statusReason)
    || Boolean(customer.note);
}

export function buildSessionReportEnrichment(summary: SessionReportSummary, customerDetails: SessionReportCustomerDetail[]): SessionReportEnrichment {
  const overview = summary.sections.overview;
  const coverage = overview.planned > 0 ? overview.visited / overview.planned : 0;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const opportunities = [...summary.sections.opportunities];
  const risks = [...summary.sections.risks];
  const recommendedActions: SessionReportRecommendedAction[] = [];
  const visitedWithoutSignals = customerDetails.filter((customer) => customer.visitStatus === "visited" && !hasSignal(customer));
  const customersWithSignals = customerDetails.filter(hasSignal).length;
  let score = 50;

  if (overview.planned > 0 && coverage >= 0.7) {
    score += 20;
    reasons.push(`Độ phủ tốt: ${overview.visited}/${overview.planned} khách (${percent(overview.visited, overview.planned)}%).`);
  } else if (overview.planned > 0 && coverage >= 0.35) {
    score += 5;
    reasons.push(`Độ phủ trung bình: ${overview.visited}/${overview.planned} khách (${percent(overview.visited, overview.planned)}%).`);
  } else if (overview.planned > 0) {
    score -= 20;
    const message = `Độ phủ thấp: ${overview.visited}/${overview.planned} khách (${percent(overview.visited, overview.planned)}%).`;
    reasons.push(message);
    warnings.push(message);
    risks.unshift(message);
    recommendedActions.push({
      type: "route_coverage",
      priority: "high",
      action: "Rà lại toàn bộ khách chưa ghé và ghi rõ lý do bỏ sót tuyến.",
      reason: message
    });
  }

  if (overview.orders > 0) {
    score += 10;
    const message = `Có ${overview.orders} đơn phát sinh trong phiên.`;
    reasons.push(message);
    opportunities.unshift(message);
    recommendedActions.push({
      type: "order_followup",
      priority: "medium",
      action: "Kiểm tra trạng thái xử lý và giao hàng của các đơn phát sinh.",
      reason: message
    });
  }

  if (overview.tests > 0) {
    score += 5;
    const message = `Có ${overview.tests} test sản phẩm cần theo dõi kết quả.`;
    reasons.push(message);
    opportunities.push(message);
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
    const message = "Có test sản phẩm nhưng chưa có follow-up đi kèm.";
    reasons.push(message);
    warnings.push(message);
    risks.push(message);
    customerDetails.filter((customer) => customer.tests.length > 0 && customer.followups.length === 0).forEach((customer) => {
      recommendedActions.push({
        type: "test_followup",
        priority: "high",
        customerId: customer.customerId || customer.id,
        customerName: customer.customerName,
        action: "Tạo follow-up sau test sản phẩm.",
        reason: customer.tests.map((item) => `${item.productName}${item.note ? `: ${item.note}` : ""}`).join("; ") || message
      });
    });
  }

  if (visitedWithoutSignals.length > 0) {
    score -= Math.min(10, visitedWithoutSignals.length * 2);
    const message = `${visitedWithoutSignals.length} khách đã ghé nhưng chưa có đơn, test, quan sát, follow-up hoặc ghi chú kết quả.`;
    warnings.push(message);
    risks.push(message);
    visitedWithoutSignals.forEach((customer) => {
      recommendedActions.push({
        type: "customer_followup",
        priority: "medium",
        customerId: customer.customerId || customer.id,
        customerName: customer.customerName,
        action: "Bổ sung kết quả ghé khách hoặc tạo follow-up cụ thể.",
        reason: "Khách đã ghé nhưng snapshot chưa có tín hiệu hành động."
      });
    });
  }

  const completeCustomerCoverage = customerDetails.length === overview.planned;
  if (!completeCustomerCoverage) {
    score -= 15;
    const message = `Chi tiết khách chưa đủ: ${customerDetails.length}/${overview.planned} khách.`;
    warnings.push(message);
    risks.push(message);
    recommendedActions.push({
      type: "data_quality",
      priority: "high",
      action: "Rebuild snapshot sau khi đồng bộ đủ khách trong phiên.",
      reason: message
    });
  }

  score = clamp(score, 0, 100);
  const health: SessionReportHealth = score >= 70 ? "good" : score >= 45 ? "watch" : "risk";
  const summaryText = health === "good"
    ? "Phiên có độ phủ và tín hiệu thương mại tốt; ưu tiên chuyển các phát sinh thành hành động cụ thể."
    : health === "watch"
      ? "Phiên có tín hiệu bán hàng hoặc test nhưng còn điểm cần theo dõi trước khi kết luận hiệu quả tuyến."
      : "Phiên có độ phủ hoặc chất lượng dữ liệu thấp; cần xử lý các khoảng trống trước khi dùng làm báo cáo quản trị.";

  const normalizedActions = recommendedActions.filter((item, index, values) => values.findIndex((candidate) =>
    candidate.type === item.type
    && candidate.customerId === item.customerId
    && candidate.action === item.action
  ) === index);

  const insights = {
    summary: summaryText,
    reasons: unique(reasons),
    opportunities: unique(opportunities),
    risks: unique(risks),
    dataQuality: {
      customerDetails: customerDetails.length,
      expectedCustomers: overview.planned,
      completeCustomerCoverage,
      customersWithSignals,
      visitedWithoutSignals: visitedWithoutSignals.length
    }
  };

  return {
    schemaVersion: "mcp.session-report.snapshot.v2",
    customerDetails,
    insights,
    score,
    health,
    warnings: unique(warnings),
    recommendedActions: normalizedActions,
    aiPromptContext: {
      schemaVersion: "mcp.session-report.ai-context.v1",
      reportType: "mcp_session_report",
      language: "vi",
      selectedOnly: true,
      task: "mcp_session_report_analysis",
      instructions: [
        "Chỉ phân tích dữ liệu có trong context; không bịa dữ liệu còn thiếu.",
        "Nêu rõ dữ liệu chưa đủ hoặc mâu thuẫn thay vì suy đoán.",
        "Ưu tiên độ phủ tuyến, đơn hàng, test, quan sát, follow-up và hành động theo khách.",
        "Không tự tạo giá, số điện thoại, địa chỉ, doanh thu hoặc khách hàng."
      ],
      session: summary.session,
      overview,
      assessment: { score, health, summary: summaryText, reasons: insights.reasons },
      warnings: unique(warnings),
      recommendedActions: normalizedActions,
      market: {
        competitors: summary.sections.competitors,
        usedProducts: summary.sections.usedProducts,
        opportunities: insights.opportunities,
        risks: insights.risks,
        observations: summary.sections.observations
      },
      commerce: {
        orders: summary.sections.orders,
        tests: summary.sections.tests
      },
      followups: summary.sections.followups,
      customerDetails
    }
  };
}
