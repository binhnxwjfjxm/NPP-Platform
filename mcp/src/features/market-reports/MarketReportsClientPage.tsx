"use client";

import { useMemo, useState } from "react";
import { ExportMenu, buildExportLink } from "@/features/exports/ExportLinks";
import { CompactKpiStrip } from "@/ui/cards/CompactKpiStrip";
import { OperationalListCard } from "@/ui/cards/OperationalListCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { BottomSheet } from "@/ui/overlay/BottomSheet";
import { AppShell } from "@/ui/shell/AppShell";
import { userFacingError } from "@/lib/ui/user-facing-error";
import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";
import { businessText } from "@/lib/ui/business-text";
import type {
  MarketReportItem,
  MarketReportKpi,
  MarketReportStatus,
  SessionReportCustomer
} from "./market-reports.types";
import styles from "./MarketReportsClientPage.module.css";

type ReportTab = "overview" | "orders" | "tests" | "observations" | "followups" | "customers" | "ai";
type AgentProductInsight = { product?: string; status?: string; insight?: string };
type AgentCustomerAction = { customer?: string; priority?: string; action?: string; reason?: string };
type AgentOrderOpportunity = { customer?: string; products?: string[]; confidence?: string; reason?: string };
type AgentResult = {
  summary: string;
  market_insights: string[];
  product_insights: AgentProductInsight[];
  customer_actions: AgentCustomerAction[];
  order_opportunities: AgentOrderOpportunity[];
  risks: string[];
  next_steps: string[];
};
type AgentResponse = {
  ok?: boolean;
  source?: string;
  error?: string;
  result?: unknown;
  persisted?: boolean;
  aiAnalyzedAt?: string;
};
type AgentState = { result: AgentResult; source?: string; analyzedAt?: string };

const TABS: Array<{ id: ReportTab; label: string }> = [
  { id: "overview", label: "Tổng quan" },
  { id: "orders", label: "Đơn hàng" },
  { id: "tests", label: "Kết quả thử" },
  { id: "observations", label: "Ghi nhận thị trường" },
  { id: "followups", label: "Việc theo dõi" },
  { id: "customers", label: "Điểm bán" },
  { id: "ai", label: "Phân tích AI" }
];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => businessText(item)).filter(Boolean) : [];
}

function objectList<T>(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as T[] : [];
}

function normalizeAgentResult(value: unknown): AgentResult {
  const row = object(value);
  return {
    summary: businessText(row.summary),
    market_insights: stringList(row.market_insights),
    product_insights: objectList<AgentProductInsight>(row.product_insights).map((item) => ({ ...item, status: businessText(item.status), insight: businessText(item.insight) })),
    customer_actions: objectList<AgentCustomerAction>(row.customer_actions).map((item) => ({ ...item, priority: businessText(item.priority), action: businessText(item.action), reason: businessText(item.reason) })),
    order_opportunities: objectList<AgentOrderOpportunity>(row.order_opportunities).map((item) => ({ ...item, confidence: businessText(item.confidence), reason: businessText(item.reason) })),
    risks: stringList(row.risks),
    next_steps: stringList(row.next_steps)
  };
}

function savedAgentState(report: MarketReportItem): AgentState | null {
  const stored = object(report.aiResult);
  const result = normalizeAgentResult(stored.result || stored);
  const hasData = Boolean(result.summary || result.market_insights.length || result.product_insights.length || result.customer_actions.length || result.risks.length || result.next_steps.length);
  return hasData ? { result, source: text(stored.source) || "saved_ai_result", analyzedAt: report.aiAnalyzedAt } : null;
}

function pct(done: number, total: number) {
  return total ? `${Math.round((done / total) * 100)}%` : "0%";
}

function money(value?: number) {
  return `${Math.round(Number(value || 0)).toLocaleString("vi-VN")}đ`;
}

function statusLabel(status: MarketReportStatus) {
  if (status === "opportunity") return "Tốt";
  if (status === "risk") return "Cần xử lý";
  return "Theo dõi";
}

function statusClass(status: MarketReportStatus) {
  if (status === "opportunity") return `${styles.status} ${styles.opportunity}`;
  if (status === "risk") return `${styles.status} ${styles.risk}`;
  return `${styles.status} ${styles.normal}`;
}

function dataExportUrl(report: MarketReportItem, format: "json" | "markdown") {
  return `/api/mcp-session-report/export?sessionId=${encodeURIComponent(report.sessionId)}&format=${format}`;
}

function pdfUrl(report: MarketReportItem) {
  return `/api/pdf/session-day?sessionId=${encodeURIComponent(report.sessionId)}`;
}

function excelUrl(report: MarketReportItem) {
  return `/api/backend/exports/mcp-sessions.csv?sessionId=${encodeURIComponent(report.sessionId)}`;
}

function wordUrl(report: MarketReportItem) {
  return `/api/mcp-session-report/word?sessionId=${encodeURIComponent(report.sessionId)}`;
}

function ReportExportMenu({ report, label = "Xuất báo cáo" }: { report: MarketReportItem; label?: string }) {
  return <ExportMenu
    label={label}
    groups={[
      {
        title: "Xuất văn phòng",
        links: [
          buildExportLink("PDF", pdfUrl(report), "primary", "Xem, in hoặc gửi quản lý"),
          buildExportLink("Excel", excelUrl(report), undefined, "Lọc và đối chiếu danh sách khách"),
          buildExportLink("Word", wordUrl(report), undefined, "Bản báo cáo có thể chỉnh sửa")
        ]
      },
      {
        title: "Dữ liệu báo cáo",
        links: [
          buildExportLink("Xuất dữ liệu", dataExportUrl(report, "json"), undefined, "Dữ liệu có cấu trúc để phân tích"),
          buildExportLink("Xuất văn bản", dataExportUrl(report, "markdown"), undefined, "Bản văn bản để đọc hoặc phân tích")
        ]
      }
    ]}
  />;
}

function Empty({ children }: { children: string }) {
  return <div className="empty-inline">{children}</div>;
}

function TextList({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? <div className={styles.textList}>{items.map((item) => <p key={item}>{item}</p>)}</div> : <Empty>{empty}</Empty>;
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className={styles.reportMetric}><span>{label}</span><strong>{value}</strong>{hint ? <small>{hint}</small> : null}</div>;
}

function DetailRow({ title, meta, note }: { title: string; meta?: string; note?: string }) {
  return <article className={styles.detailRow}><div><strong>{title}</strong>{meta ? <span>{meta}</span> : null}</div>{note ? <p>{note}</p> : null}</article>;
}

function ReportCard({ report, onOpen }: { report: MarketReportItem; onOpen: () => void }) {
  const ov = report.overview;
  return <OperationalListCard
    leading={<span>▣</span>}
    eyebrow={`Báo cáo phiên · ${report.date}`}
    title={businessText(report.subject)}
    description={`${report.routeName} · ${ov.visited}/${ov.planned} điểm bán · ${ov.orders} đơn · ${ov.tests} lượt thử`}
    badge={<strong className={statusClass(report.status)}>{statusLabel(report.status)} · {report.score}</strong>}
    meta={[`Độ phủ ${pct(ov.visited, ov.planned)}`, `${report.sections.customers?.length || 0}/${ov.planned} điểm bán có chi tiết`, businessText(report.nextAction)]}
    actions={[{ label: "Xem", tone: "primary", onClick: onOpen }]}
    actionContent={<ReportExportMenu report={report} />}
  />;
}

function OverviewTab({ report }: { report: MarketReportItem }) {
  const ov = report.overview;
  return <div className={styles.reportTabBody}>
    <section className={styles.reportHero}>
      <div><span>Đánh giá phiên</span><strong>{statusLabel(report.status)} · {report.score}/100</strong><p>{businessText(report.insights.summary || report.note)}</p></div>
      <ReportExportMenu report={report} />
    </section>
    <div className={styles.reportMetricGrid}>
      <Metric label="Điểm bán" value={ov.planned} hint={`${ov.visited} đã ghé · ${ov.pending} chờ`} />
      <Metric label="Độ phủ" value={pct(ov.visited, ov.planned)} hint={`${ov.skipped} bỏ qua`} />
      <Metric label="Đơn / lượt thử" value={`${ov.orders}/${ov.tests}`} />
      <Metric label="Chi tiết điểm bán" value={`${report.sections.customers?.length || 0}/${ov.planned}`} hint={report.insights.dataQuality?.completeCustomerCoverage ? "Đã đủ" : "Chưa đủ"} />
    </div>
    <div className="grid">
      <div className="metric-row"><span>Nhân viên phụ trách</span><strong>{report.sales || "-"}</strong></div>
      <div className="metric-row"><span>Tuyến</span><strong>{report.routeName}</strong></div>
      <div className="metric-row"><span>Ngày phiên</span><strong>{report.date}</strong></div>
      <div className="metric-row"><span>Thời điểm chốt</span><strong>{report.snapshotAt || "-"}</strong></div>
    </div>
    <section className={styles.twoColumnSection}>
      <div><h3>Lý do đánh giá</h3><TextList items={report.insights.reasons} empty="Chưa có lý do đánh giá." /></div>
      <div><h3>Cảnh báo</h3><TextList items={report.warnings} empty="Không có cảnh báo." /></div>
    </section>
    <section><h3>Hành động đề xuất</h3>{report.recommendedActions.length ? <div className={styles.detailList}>{report.recommendedActions.map((item, index) => <DetailRow key={`${item.type || "action"}-${item.customerId || index}`} title={businessText(`${item.customerName ? `${item.customerName} · ` : ""}${item.action || "Việc cần làm"}`)} meta={item.priority || "Ưu tiên vừa"} note={businessText(item.reason)} />)}</div> : <Empty>Chưa có hành động đề xuất.</Empty>}</section>
  </div>;
}

function OrdersTab({ report }: { report: MarketReportItem }) {
  return report.sections.orders.length ? <div className={styles.detailList}>{report.sections.orders.map((item) => <DetailRow key={item.id} title={`${item.customerName || "Khách"} · ${item.code || item.id}`} meta={`${businessText(item.status || "-")} · ${money(item.total)}`} note={item.note} />)}</div> : <Empty>Phiên này chưa có đơn hàng.</Empty>;
}

function TestsTab({ report }: { report: MarketReportItem }) {
  return report.sections.tests.length ? <div className={styles.detailList}>{report.sections.tests.map((item) => <DetailRow key={item.id} title={`${item.customerName || "Khách"} · ${item.productName || "Sản phẩm được thử"}`} meta={businessText(item.status || "-")} note={item.note} />)}</div> : <Empty>Phiên này chưa có kết quả thử sản phẩm.</Empty>;
}

function ObservationsTab({ report }: { report: MarketReportItem }) {
  return <div className={styles.reportTabBody}>
    <section className={styles.chipSection}><strong>Đối thủ</strong>{report.sections.competitors.length ? <div className={styles.chips}>{report.sections.competitors.map((item) => <span key={item.label}>{item.label} · {item.count}</span>)}</div> : <Empty>Chưa ghi nhận.</Empty>}</section>
    <section className={styles.chipSection}><strong>Sản phẩm khách đang dùng</strong>{report.sections.usedProducts.length ? <div className={styles.chips}>{report.sections.usedProducts.map((item) => <span key={item.label}>{item.label} · {item.count}</span>)}</div> : <Empty>Chưa ghi nhận.</Empty>}</section>
    <section className={styles.twoColumnSection}><div><h3>Cơ hội</h3><TextList items={report.insights.opportunities} empty="Chưa có cơ hội." /></div><div><h3>Rủi ro</h3><TextList items={report.insights.risks} empty="Chưa có rủi ro." /></div></section>
    <section><h3>Quan sát chi tiết</h3>{report.sections.observations.length ? <div className={styles.detailList}>{report.sections.observations.map((item, index) => <DetailRow key={item.id || index} title={item.customerName || `Quan sát ${index + 1}`} meta={[...(item.competitors || []), ...(item.usedProducts || [])].join(" · ")} note={item.note || item.summary} />)}</div> : <Empty>Chưa có quan sát chi tiết.</Empty>}</section>
  </div>;
}

function FollowupsTab({ report }: { report: MarketReportItem }) {
  return report.sections.followups.length ? <div className={styles.detailList}>{report.sections.followups.map((item) => <DetailRow key={item.id} title={`${item.customerName || "Khách"} · ${item.title || "Việc theo dõi"}`} meta={`${businessText(item.priority || "-")} · ${businessText(item.status || "-")} · ${item.dueDate || "chưa hẹn"}`} note={item.note || item.owner} />)}</div> : <Empty>Phiên này chưa có việc cần theo dõi.</Empty>;
}

function customerMeta(customer: SessionReportCustomer) {
  return [businessText(customer.visitStatus || customer.status || "Chờ xử lý"), customer.area, customer.phone].filter(Boolean).join(" · ");
}

function customerNote(customer: SessionReportCustomer) {
  const signals = `${customer.orders?.length || 0} đơn · ${customer.tests?.length || 0} lượt thử · ${customer.observations?.length || 0} ghi nhận · ${customer.followups?.length || 0} việc theo dõi`;
  return [signals, customer.statusReason, customer.note].filter(Boolean).join(" · ");
}

function CustomersTab({ report }: { report: MarketReportItem }) {
  const rows = report.sections.customers || [];
  return <div className={styles.reportTabBody}>
    <div className={styles.reportMetricGrid}><Metric label="Tổng khách" value={report.overview.planned} /><Metric label="Đã ghé" value={report.overview.visited} /><Metric label="Chờ" value={report.overview.pending} /><Metric label="Đã lưu chi tiết" value={rows.length} hint={rows.length === report.overview.planned ? "Đủ 100%" : "Chưa đủ"} /></div>
    {rows.length ? <div className={styles.detailList}>{rows.map((item, index) => <DetailRow key={item.id || index} title={`${item.sortOrder || index + 1}. ${item.customerName || `Khách ${index + 1}`}`} meta={customerMeta(item)} note={customerNote(item)} />)}</div> : <Empty>Báo cáo chưa có đủ chi tiết điểm bán. Vui lòng tạo lại báo cáo phiên.</Empty>}
  </div>;
}

function AgentResultView({ state }: { state: AgentState }) {
  const { result } = state;
  return <div className={styles.reportTabBody}>
    <section className={styles.aiPanel}><span>Kết quả phân tích đã lưu</span><strong>{state.analyzedAt || "Đã phân tích"}</strong><p>{result.summary || "Chưa có nội dung tóm tắt."}</p></section>
    <section className={styles.twoColumnSection}><div><h3>Nhận định thị trường</h3><TextList items={result.market_insights} empty="Chưa có nhận định." /></div><div><h3>Rủi ro</h3><TextList items={result.risks} empty="Chưa có rủi ro." /></div></section>
    <section><h3>Sản phẩm</h3>{result.product_insights.length ? <div className={styles.detailList}>{result.product_insights.map((item, index) => <DetailRow key={`${item.product || "product"}-${index}`} title={item.product || `Sản phẩm ${index + 1}`} meta={item.status || "Chưa phân loại"} note={item.insight} />)}</div> : <Empty>Chưa có nhận định sản phẩm.</Empty>}</section>
    <section><h3>Hành động theo khách</h3>{result.customer_actions.length ? <div className={styles.detailList}>{result.customer_actions.map((item, index) => <DetailRow key={`${item.customer || "customer"}-${index}`} title={item.customer || `Khách ${index + 1}`} meta={item.priority || "Ưu tiên vừa"} note={[item.action, item.reason].filter(Boolean).join(" · ")} />)}</div> : <Empty>Chưa có hành động theo khách.</Empty>}</section>
    <section><h3>Cơ hội đơn hàng</h3>{result.order_opportunities.length ? <div className={styles.detailList}>{result.order_opportunities.map((item, index) => <DetailRow key={`${item.customer || "order"}-${index}`} title={item.customer || `Khách ${index + 1}`} meta={`${item.confidence || "Mức vừa"} · ${(item.products || []).join(", ") || "chưa rõ sản phẩm"}`} note={businessText(item.reason)} />)}</div> : <Empty>Chưa có cơ hội đơn hàng.</Empty>}</section>
    <section><h3>Việc tiếp theo</h3><TextList items={result.next_steps} empty="Chưa có việc tiếp theo." /></section>
  </div>;
}

function AiTab({ report }: { report: MarketReportItem }) {
  const [agent, setAgent] = useState<AgentState | null>(() => savedAgentState(report));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runAgent() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await idempotentMutationFetch(
        "/api/mcp-session-report/analyze",
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: report.sessionId })
        },
        { operation: "session-report.analyze" }
      );
      const payload = await response.json().catch(() => ({})) as AgentResponse;
      const result = normalizeAgentResult(payload.result);
      if (!response.ok || payload.ok === false) setError(userFacingError(payload.error || result.summary, "Chưa thể phân tích báo cáo. Vui lòng thử lại."));
      if (payload.ok && payload.persisted) setAgent({ result, source: payload.source || "mcp_report_agent", analyzedAt: payload.aiAnalyzedAt || new Date().toISOString() });
    } catch (cause) {
      setError(userFacingError(cause, "Chưa thể phân tích báo cáo. Vui lòng thử lại."));
    } finally {
      setLoading(false);
    }
  }

  return <div className={styles.reportTabBody}>
    <section className={styles.aiPanel}>
      <span>Dữ liệu báo cáo đã sẵn sàng để phân tích</span>
      <strong>{agent ? "Đã có kết quả phân tích" : "Sẵn sàng phân tích"}</strong>
      <p>{businessText(report.insights.summary, "Báo cáo chưa có nhận định.")}</p>
      <div className="sheet-action-grid">
        <button className="button primary" type="button" onClick={runAgent} disabled={loading}>{loading ? "Đang phân tích..." : agent ? "Phân tích lại và lưu" : "Phân tích báo cáo"}</button>
        <a className="button" href={dataExportUrl(report, "json")} target="_blank" rel="noreferrer">Xuất dữ liệu</a>
        <a className="button" href={dataExportUrl(report, "markdown")} target="_blank" rel="noreferrer">Xuất văn bản</a>
      </div>
    </section>
    {error ? <Empty>{error}</Empty> : null}
    {agent ? <AgentResultView state={agent} /> : <><section className={styles.twoColumnSection}><div><h3>Cơ hội đã lưu</h3><TextList items={report.insights.opportunities} empty="Chưa có cơ hội." /></div><div><h3>Cảnh báo đã lưu</h3><TextList items={report.warnings} empty="Không có cảnh báo." /></div></section><section><h3>Hành động đề xuất đã lưu</h3>{report.recommendedActions.length ? <div className={styles.detailList}>{report.recommendedActions.map((item, index) => <DetailRow key={`${item.type || "action"}-${index}`} title={businessText(`${item.customerName ? `${item.customerName} · ` : ""}${item.action || "Việc cần làm"}`)} meta={item.priority || "Ưu tiên vừa"} note={businessText(item.reason)} />)}</div> : <Empty>Chưa có hành động đề xuất.</Empty>}</section></>}
  </div>;
}

function ReportSheet({ report, onClose }: { report: MarketReportItem | null; onClose: () => void }) {
  const [tab, setTab] = useState<ReportTab>("overview");
  return <BottomSheet open={Boolean(report)} onClose={onClose} title={report ? `Báo cáo phiên · ${report.routeName}` : "Chi tiết báo cáo phiên"} description={report ? `${report.accountName} · ${report.date}` : undefined} footer={<div className="sheet-action-grid"><button className="button" type="button" onClick={onClose}>Đóng</button>{report ? <ReportExportMenu report={report} /> : null}</div>}>
    {report ? <div className={styles.reportSheet}><div className={styles.tabBar}>{TABS.map((item) => <button key={item.id} className={tab === item.id ? styles.activeTab : ""} type="button" onClick={() => setTab(item.id)}>{item.label}</button>)}</div>{tab === "overview" ? <OverviewTab report={report} /> : null}{tab === "orders" ? <OrdersTab report={report} /> : null}{tab === "tests" ? <TestsTab report={report} /> : null}{tab === "observations" ? <ObservationsTab report={report} /> : null}{tab === "followups" ? <FollowupsTab report={report} /> : null}{tab === "customers" ? <CustomersTab report={report} /> : null}{tab === "ai" ? <AiTab key={report.id} report={report} /> : null}</div> : null}
  </BottomSheet>;
}

export function MarketReportsClientPage({ kpis, reports, focusSessionId = "" }: { kpis: MarketReportKpi[]; reports: MarketReportItem[]; focusSessionId?: string }) {
  const focused = useMemo(() => reports.find((report) => report.sessionId === focusSessionId || report.id === focusSessionId) || null, [focusSessionId, reports]);
  const [selected, setSelected] = useState<MarketReportItem | null>(focused);
  const needAction = reports.filter((report) => report.health === "risk").length;
  return <AppShell activeHref="/reports"><PageHeader eyebrow="Báo cáo phiên" title="Báo cáo phiên" subtitle="Tổng hợp kết quả đi tuyến để quản lý xem nhanh, xuất báo cáo và phân tích khi cần."><span className="badge">{needAction} cần xử lý</span></PageHeader><FilterBar filters={[{ label: "Phạm vi", value: "Theo phiên đi tuyến" }, { label: "Tình trạng", value: "Đã chốt" }, { label: "Sắp xếp", value: "Mới nhất trước" }]} /><CompactKpiStrip items={kpis} /><div className={styles.templateGrid}><span>Báo cáo đã chốt</span><span>Chi tiết điểm bán</span><span>PDF · Excel · Word</span><span>Lưu kết quả phân tích</span></div><section className={styles.section}><div className="dashboard-section-head"><h2>Báo cáo phiên đã chốt</h2><span>{reports.length} phiên</span></div><div className={styles.list}>{reports.length ? reports.map((report) => <ReportCard key={report.id} report={report} onOpen={() => setSelected(report)} />) : <div className="empty-inline">Chưa có báo cáo phiên.</div>}</div></section><ReportSheet report={selected} onClose={() => setSelected(null)} /></AppShell>;
}
