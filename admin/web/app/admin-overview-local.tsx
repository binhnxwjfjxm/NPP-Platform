"use client";

import Link from "next/link";
import { AdminIcon } from "./admin-icons";
import {
  AdminFilterChip,
  AdminKpiCard,
  AdminKpiGrid,
  AdminStatePanel,
  AdminStatusBadge,
  AdminToolbar,
} from "./admin-ui-primitives";
import { useAdminLocalRead } from "./local-read/use-admin-local-read";
import type { AdminControlTowerData } from "../lib/control-tower";
import type { ProposalItem } from "./approvals/proposal-data";
import type { AdminAlert, AlertCenterData } from "./alerts/alert-data";
import styles from "./overview.module.css";

type MetricRow = Record<string, unknown>;
type ReportPeriod = "Hôm nay" | "7 ngày" | "Tháng này" | "Quý này";

const reportPeriods: readonly ReportPeriod[] = ["Hôm nay", "7 ngày", "Tháng này", "Quý này"];

const familyLabels: Record<string, string> = {
  sales: "Kinh doanh",
  purchasing: "Mua hàng",
  inventory: "Kho",
  aging: "Công nợ",
  grossMargin: "Lãi gộp",
  "gross-margin": "Lãi gộp",
  employeeMcp: "MCP",
  "employee-mcp": "MCP",
  logistics: "Giao vận",
  cod: "COD",
};

function metricText(row: MetricRow | undefined | null, key: string, fallback = "—"): string {
  const value = row?.[key];
  if (typeof value === "string" && value.length) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function exactDecimal(value: string): string {
  const [integer, fraction] = value.split(".");
  const sign = integer.startsWith("-") ? "-" : "";
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped}${fraction ? `,${fraction}` : ""}`;
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(parsed);
}

function overviewHref(period: ReportPeriod): string {
  return period === "Tháng này" ? "/" : `/?period=${encodeURIComponent(period)}`;
}

function reportDetailHref(reportId: string, period: ReportPeriod): string {
  const params = new URLSearchParams({ period, returnTo: overviewHref(period) });
  return `/reports/${reportId}?${params.toString()}`;
}

function proposalRank(item: ProposalItem): number {
  if (item.priority === "critical") return 3;
  if (item.priority === "high") return 2;
  return 1;
}

function alertRank(item: AdminAlert): number {
  if (item.severity === "critical") return 3;
  if (item.severity === "high") return 2;
  return 1;
}

function sourceMessage(error: string | null, hasData: boolean, label: string) {
  if (!error) return null;
  if (error === "FORBIDDEN") return `${label}: tài khoản hiện tại không có quyền xem nguồn này.`;
  if (hasData) return `${label}: đang dùng dữ liệu đã lưu; lần cập nhật gần nhất chưa thành công.`;
  return `${label}: chưa tải được dữ liệu.`;
}

export function AdminOverviewLocal({ period, from, to }: { period: ReportPeriod; from: string; to: string }) {
  const controlRead = useAdminLocalRead<AdminControlTowerData>("control-tower", period);
  const proposalRead = useAdminLocalRead<ProposalItem[]>("proposals", period);
  const alertRead = useAdminLocalRead<AlertCenterData>("alerts", period);

  const data = controlRead.data;
  const proposals = proposalRead.data;
  const alertData = alertRead.data;
  const sales = data?.management.sales?.summary;
  const inventory = data?.management.inventory?.summary;
  const logistics = data?.management.logistics?.summary;
  const grossMargin = data?.management.grossMargin?.summary;

  const pendingProposals = proposals?.filter((item) => item.status === "pending") ?? [];
  const needsInfoProposals = proposals?.filter((item) => item.status === "needs-info") ?? [];
  const urgentProposals = pendingProposals.filter((item) => item.priority === "critical");
  const activeAlerts = alertData ? alertData.alerts.filter((item) => item.status !== "resolved") : null;
  const highAlerts = activeAlerts?.filter((item) => item.severity === "critical" || item.severity === "high") ?? [];

  const priorityProposal = [...pendingProposals]
    .sort((left, right) => proposalRank(right) - proposalRank(left) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  const priorityAlert = activeAlerts
    ? [...activeAlerts].sort((left, right) => alertRank(right) - alertRank(left) || Date.parse(right.detectedAt ?? "") - Date.parse(left.detectedAt ?? ""))[0]
    : undefined;

  const reportWarningFamilies = new Set(data?.warnings.map((item) => item.family) ?? []);
  const executiveReportState = !data ? "Chưa sẵn sàng" : data.warnings.length ? "Chưa đầy đủ" : "Bình thường";
  const executiveReportNote = !data
    ? "Chưa tải được số liệu điều hành"
    : data.warnings.length
      ? `${reportWarningFamilies.size} nguồn cần kiểm tra`
      : `Số liệu Công Ty đã sẵn sàng · ${period}`;

  const sourceWarnings = [
    sourceMessage(controlRead.error, Boolean(data), "Số liệu điều hành"),
    data?.warnings.length
      ? `Một số số liệu chưa đầy đủ: ${[...new Set(data.warnings.map((item) => familyLabels[item.family] ?? item.family))].join(", ")}.`
      : null,
    sourceMessage(proposalRead.error, Boolean(proposals), "Đề xuất"),
    sourceMessage(alertRead.error, Boolean(alertData), "Cảnh báo"),
  ].filter((item): item is string => Boolean(item));

  const affectedSourceKeys = new Set<string>();
  if (!data || controlRead.error) affectedSourceKeys.add("control-tower");
  else reportWarningFamilies.forEach((family) => affectedSourceKeys.add(`report:${family}`));
  if (!proposals || proposalRead.error) affectedSourceKeys.add("proposals");
  if (!alertData || alertRead.error) affectedSourceKeys.add("alerts");
  const affectedSourceCount = affectedSourceKeys.size;

  const hasIncompletePrioritySources = !proposals || !alertData || Boolean(proposalRead.error) || Boolean(alertRead.error);
  const grossMarginValue = metricText(grossMargin, "grossMarginVnd");
  const returnTo = encodeURIComponent(overviewHref(period));
  const initialLoading = !data && !proposals && !alertData && (controlRead.loading || proposalRead.loading || alertRead.loading);

  return (
    <>
      <AdminToolbar
        label="Kỳ tổng quan"
        actions={<AdminStatusBadge tone="info">{formatDate(from)} – {formatDate(to)}</AdminStatusBadge>}
      >
        {reportPeriods.map((candidate) => (
          <AdminFilterChip key={candidate} href={overviewHref(candidate)} label={candidate} active={period === candidate} />
        ))}
      </AdminToolbar>

      {initialLoading ? (
        <AdminStatePanel className={styles.sourceState} title="Đang tải dữ liệu quản trị" message="Dữ liệu đã lưu sẽ được hiển thị trước nếu có trên thiết bị này." tone="partial" icon="info" />
      ) : null}

      {sourceWarnings.length ? (
        <AdminStatePanel
          className={styles.sourceState}
          title="Một số nguồn cần kiểm tra"
          message={sourceWarnings.join(" ")}
          tone="partial"
          icon="info"
        />
      ) : null}

      <AdminKpiGrid label="Chỉ số quản trị">
        <AdminKpiCard label="Đơn bán hiệu lực" value={metricText(sales, "effectiveOrderCount")} icon="clipboard" href={reportDetailHref("sales-profit-summary", period)} />
        <AdminKpiCard label="SKU đang có tồn" value={metricText(inventory, "stockedSkuCount")} icon="warehouse" href={reportDetailHref("inventory-overview", period)} />
        <AdminKpiCard label="Giao thất bại" value={metricText(logistics, "failedCount")} icon="exception" href={reportDetailHref("delivery-cod-overview", period)} />
        <AdminKpiCard label="Lãi gộp VND" value={grossMarginValue === "—" ? "—" : exactDecimal(grossMarginValue)} icon="coin" href={reportDetailHref("sales-profit-summary", period)} />
      </AdminKpiGrid>

      <p className="sectionEyebrow">Nhịp quản trị</p>
      <AdminKpiGrid label="Tóm tắt đề xuất, cảnh báo và điều hành">
        <AdminKpiCard
          label="Chờ quyết định"
          value={proposals ? pendingProposals.length : "—"}
          note={proposals ? `${urgentProposals.length} ưu tiên cao · ${needsInfoProposals.length} chờ bổ sung` : "Chưa tải được"}
          icon="check"
          href="/approvals"
          tone={urgentProposals.length ? "attention" : "neutral"}
        />
        <AdminKpiCard
          label="Cảnh báo mở"
          value={activeAlerts ? activeAlerts.length : "—"}
          note={activeAlerts ? `${highAlerts.length} mức cao` : "Chưa tải được"}
          icon="exception"
          href="/alerts"
          tone={highAlerts.length ? "attention" : "neutral"}
        />
        <AdminKpiCard
          label="Điều hành"
          value={executiveReportState}
          note={executiveReportNote}
          icon="overview"
          href="/reports"
          tone={!data || data.warnings.length ? "attention" : "success"}
        />
        <AdminKpiCard
          label="Nguồn cần kiểm tra"
          value={affectedSourceCount}
          note={affectedSourceCount ? "Có nguồn chưa sẵn sàng, chưa đầy đủ hoặc đang dùng dữ liệu đã lưu" : "Các nguồn đang sẵn sàng"}
          icon="info"
          tone={affectedSourceCount ? "attention" : "success"}
        />
      </AdminKpiGrid>

      <p className="sectionEyebrow">Ưu tiên hôm nay</p>
      <section className="overviewFocusList" aria-label="Việc cần chú ý hôm nay">
        {priorityProposal ? <Link className="card overviewFocusItem" href={`/approvals/${encodeURIComponent(priorityProposal.id)}?returnTo=${returnTo}`}><span className="rowIcon"><AdminIcon name="check" size={19} /></span><span><small>Đề xuất</small><strong>{priorityProposal.title}</strong><em>{priorityProposal.impact}</em></span><AdminIcon name="chevronRight" size={17} /></Link> : null}
        {priorityAlert ? <Link className="card overviewFocusItem" href={`/alerts/${encodeURIComponent(priorityAlert.id)}?period=${encodeURIComponent(period)}&returnTo=${returnTo}`}><span className="rowIcon"><AdminIcon name="exception" size={19} /></span><span><small>Cảnh báo</small><strong>{priorityAlert.title}</strong><em>{priorityAlert.actual} · Ngưỡng {priorityAlert.threshold}</em></span><AdminIcon name="chevronRight" size={17} /></Link> : null}
        {!priorityProposal && !priorityAlert && !initialLoading ? (
          <AdminStatePanel
            className={styles.focusState}
            title={hasIncompletePrioritySources ? "Chưa xác định đầy đủ việc ưu tiên." : "Không có việc ưu tiên đang mở."}
            message={hasIncompletePrioritySources ? "Một số nguồn chưa sẵn sàng hoặc đang chờ cập nhật; xem trạng thái nguồn ở phía trên để kiểm tra." : "Các nguồn đã tải hiện không có Đề xuất chờ quyết định hoặc Cảnh báo mở."}
            tone={hasIncompletePrioritySources ? "partial" : "ok"}
          />
        ) : null}
      </section>
    </>
  );
}
