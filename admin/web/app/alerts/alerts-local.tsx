"use client";

import Link from "next/link";
import { AdminIconTabs } from "../admin-icon-tabs";
import {
  AdminFilterChip,
  AdminKpiCard,
  AdminKpiGrid,
  AdminStatePanel,
  AdminStatusBadge,
  AdminToolbar,
  type AdminStatusTone,
} from "../admin-ui-primitives";
import { useAdminLocalRead } from "../local-read/use-admin-local-read";
import type { AlertCenterData, AlertDomain, AlertSeverity, AlertStatus } from "./alert-data";

type ReportPeriod = "Hôm nay" | "7 ngày" | "Tháng này" | "Quý này";
const reportPeriods: readonly ReportPeriod[] = ["Hôm nay", "7 ngày", "Tháng này", "Quý này"];
const severityLabels: Record<AlertSeverity, string> = { critical: "Nghiêm trọng", high: "Cao", attention: "Cần chú ý" };
const statusLabels: Record<AlertStatus, string> = { new: "Mới", seen: "Đã xem", handling: "Đang xử lý", resolved: "Đã giải quyết" };
const domainTabs = new Set<AlertDomain>(["sales", "debt", "inventory", "delivery", "mcp"]);

function dateTime(value: string | null) {
  if (!value) return "Chưa có thời gian";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(date);
}

function alertHref(tab: string, period: string): string {
  const params = new URLSearchParams();
  if (tab !== "all") params.set("tab", tab);
  if (period !== "Tháng này") params.set("period", period);
  const query = params.toString();
  return query ? `/alerts?${query}` : "/alerts";
}

function severityTone(severity: AlertSeverity): AdminStatusTone {
  if (severity === "critical") return "danger";
  if (severity === "high") return "attention";
  return "info";
}

function statusTone(status: AlertStatus): AdminStatusTone {
  if (status === "resolved") return "success";
  if (status === "new") return "danger";
  if (status === "handling") return "attention";
  return "info";
}

export function AlertsLocal({ activeTab, period }: { activeTab: string; period: ReportPeriod }) {
  const read = useAdminLocalRead<AlertCenterData>("alerts", period);
  const data = read.data;
  const activeAlerts = data ? data.alerts.filter((item) => item.status !== "resolved") : null;
  const selectedDomain = domainTabs.has(activeTab as AlertDomain) ? activeTab as AlertDomain : null;
  const selectedAccess = selectedDomain && data ? data.domainAccess[selectedDomain] : null;
  const visible = activeAlerts
    ? selectedDomain ? activeAlerts.filter((item) => item.domain === selectedDomain) : activeTab === "all" ? activeAlerts : []
    : [];
  const openCount = activeAlerts ? String(activeAlerts.length) : undefined;
  const domainBadge = (domain: AlertDomain) => activeAlerts ? String(activeAlerts.filter((item) => item.domain === domain).length) : undefined;
  const tabs = [
    { href: alertHref("all", period), label: "Tổng hợp", icon: "exception" as const, active: activeTab === "all", badge: openCount },
    { href: alertHref("sales", period), label: "Kinh doanh", icon: "overview" as const, active: activeTab === "sales", badge: domainBadge("sales") },
    { href: alertHref("debt", period), label: "Công nợ", icon: "coin" as const, active: activeTab === "debt", badge: domainBadge("debt") },
    { href: alertHref("inventory", period), label: "Kho", icon: "warehouse" as const, active: activeTab === "inventory", badge: domainBadge("inventory") },
    { href: alertHref("delivery", period), label: "Giao vận", icon: "truck" as const, active: activeTab === "delivery", badge: domainBadge("delivery") },
    { href: alertHref("mcp", period), label: "MCP", icon: "mobile" as const, active: activeTab === "mcp", badge: domainBadge("mcp") },
    { href: alertHref("rules", period), label: "Quy tắc", icon: "clipboard" as const, active: activeTab === "rules" },
    { href: alertHref("history", period), label: "Lịch sử", icon: "document" as const, active: activeTab === "history" },
  ];
  const history = data
    ? data.alerts.flatMap((alert) => alert.history.map((event) => ({ alert, event }))).sort((a, b) => Date.parse(b.event.occurredAt) - Date.parse(a.event.occurredAt))
    : [];
  const highCount = activeAlerts ? activeAlerts.filter((alert) => alert.severity === "critical" || alert.severity === "high").length : null;
  const ruleDomainCount = data ? new Set(data.rules.map((rule) => rule.domainLabel)).size : null;
  const highRuleCount = data ? data.rules.filter((rule) => rule.severity === "critical" || rule.severity === "high").length : null;

  return (
    <>
      <AdminIconTabs label="Nhóm cảnh báo" tabs={tabs} />

      {activeTab !== "rules" ? (
        <AdminToolbar label="Kỳ cảnh báo">
          {reportPeriods.map((candidate) => (
            <AdminFilterChip key={candidate} href={alertHref(activeTab, candidate)} label={candidate} active={period === candidate} />
          ))}
        </AdminToolbar>
      ) : null}

      {read.error && data ? (
        <AdminStatePanel title="Đang dùng dữ liệu đã lưu" message="Lần cập nhật gần nhất chưa thành công. Hệ thống sẽ tự thử lại khi kết nối ổn định." tone="partial" icon="info" />
      ) : null}

      {read.loading && !data ? (
        <AdminStatePanel title="Đang tải cảnh báo" message="Dữ liệu đã lưu sẽ được hiển thị trước nếu có trên thiết bị này." tone="partial" icon="info" />
      ) : null}

      {activeTab === "rules" ? (
        <AdminKpiGrid label="Tóm tắt quy tắc cảnh báo">
          <AdminKpiCard label="Quy tắc đang áp dụng" value={data ? data.rules.length : "—"} note="Nguồn dữ liệu chính thức" icon="clipboard" />
          <AdminKpiCard label="Quy tắc mức cao" value={highRuleCount ?? "—"} note="Nghiêm trọng hoặc cao" icon="info" tone={highRuleCount && highRuleCount > 0 ? "attention" : "neutral"} />
          <AdminKpiCard label="Nhóm dữ liệu" value={ruleDomainCount ?? "—"} note="Có quy tắc đang áp dụng" icon="overview" />
        </AdminKpiGrid>
      ) : (
        <AdminKpiGrid label="Tóm tắt cảnh báo">
          <AdminKpiCard label="Đang hoạt động" value={activeAlerts ? activeAlerts.length : "—"} note="Chưa giải quyết" icon="exception" />
          <AdminKpiCard label="Mức cao" value={highCount ?? "—"} note="Nghiêm trọng hoặc cao" icon="info" tone={highCount && highCount > 0 ? "attention" : "neutral"} />
          <AdminKpiCard label="Quy tắc đang áp dụng" value={data ? data.rules.length : "—"} note="Nguồn dữ liệu chính thức" icon="clipboard" />
          <AdminKpiCard label="Kỳ đang xem" value={period} note="Phạm vi cảnh báo" icon="document" />
        </AdminKpiGrid>
      )}

      {!data && !read.loading ? (
        <AdminStatePanel
          title="Chưa thể hiển thị cảnh báo"
          message={read.error === "FORBIDDEN" ? "Tài khoản hiện tại không có quyền xem cảnh báo quản trị." : "Không thể tải cảnh báo ở thời điểm hiện tại."}
          tone={read.error === "FORBIDDEN" ? "forbidden" : "error"}
        />
      ) : selectedDomain && selectedAccess && !selectedAccess.available ? (
        <AdminStatePanel title="Chưa thể mở nhóm cảnh báo này" message={selectedAccess.message ?? "Nguồn dữ liệu hiện chưa sẵn sàng."} tone="partial" />
      ) : data && activeTab === "rules" ? (
        <section className="alertRuleList" aria-label="Quy tắc cảnh báo">
          {data.rules.length ? data.rules.map((rule) => (
            <article className="card alertRuleCard" key={rule.code}>
              <div>
                <AdminStatusBadge tone={severityTone(rule.severity)}>{severityLabels[rule.severity]}</AdminStatusBadge>
                <AdminStatusBadge>{rule.domainLabel}</AdminStatusBadge>
              </div>
              <h2>{rule.name}</h2>
              <p>{rule.metric} · {rule.threshold}</p>
              <small>Quy tắc dùng dữ liệu chính thức; màn hình này chỉ hiển thị.</small>
            </article>
          )) : <AdminStatePanel title="Chưa có quy tắc cảnh báo" message="Quy tắc chỉ xuất hiện khi nguồn chính thức đã được mở." tone="empty" />}
        </section>
      ) : data && activeTab === "history" ? (
        <section className="alertList" aria-label="Lịch sử cảnh báo">
          {history.length ? history.map(({ alert, event }, index) => (
            <Link className="card alertListItem" href={`/alerts/${encodeURIComponent(alert.id)}?period=${encodeURIComponent(period)}`} key={`${alert.id}-${event.occurredAt}-${index}`}>
              <div className="alertListTopline">
                <AdminStatusBadge tone={severityTone(alert.severity)}>{severityLabels[alert.severity]}</AdminStatusBadge>
                <AdminStatusBadge tone={statusTone(event.status)}>{statusLabels[event.status]}</AdminStatusBadge>
              </div>
              <h2>{alert.title}</h2>
              <p className="alertEntity">{alert.domainLabel} · {alert.entity}</p>
              <div className="alertListFooter"><span>{dateTime(event.occurredAt)} · {event.actorLabel}</span><strong>Xem chi tiết →</strong></div>
            </Link>
          )) : <AdminStatePanel title="Chưa có lịch sử xử lý" message="Lịch sử sẽ xuất hiện khi cảnh báo được cập nhật trạng thái." tone="empty" />}
        </section>
      ) : data ? (
        <section className="alertList" aria-label="Danh sách cảnh báo">
          {visible.length ? visible.map((alert) => (
            <Link className="card alertListItem" href={`/alerts/${encodeURIComponent(alert.id)}?period=${encodeURIComponent(period)}`} key={alert.id}>
              <div className="alertListTopline">
                <AdminStatusBadge tone={severityTone(alert.severity)}>{severityLabels[alert.severity]}</AdminStatusBadge>
                <AdminStatusBadge tone={statusTone(alert.status)}>{statusLabels[alert.status]}</AdminStatusBadge>
              </div>
              <h2>{alert.title}</h2>
              <p className="alertEntity">{alert.domainLabel} · {alert.entity}{alert.context ? ` · ${alert.context}` : ""}</p>
              <div className="alertMetricGrid">
                <span><small>Quy tắc</small><strong>{alert.ruleName}</strong></span>
                <span><small>Điều kiện</small><strong>{alert.threshold}</strong></span>
                <span><small>Dữ liệu ghi nhận</small><strong>{alert.actual}</strong></span>
                <span><small>Nguồn</small><strong>{alert.source}</strong></span>
              </div>
              <div className="alertListFooter"><span>{dateTime(alert.detectedAt)}</span><strong>Xem chi tiết →</strong></div>
            </Link>
          )) : <AdminStatePanel title="Không có cảnh báo đang mở" message="Không phát hiện tín hiệu cần rà soát trong nhóm đang xem." tone="ok" />}
        </section>
      ) : null}
    </>
  );
}
