"use client";

import Link from "next/link";
import { CompactKpiStrip } from "@/ui/cards/CompactKpiStrip";
import { TodaySummaryCard } from "@/ui/cards/TodaySummaryCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import { businessOwner, businessText } from "@/lib/ui/business-text";
import { useMcpShellSnapshot } from "@/lib/local-read/use-mcp-shell";
import type { McpShellAction, McpShellRouteHealth } from "@/lib/local-read/mcp-shell-types";

type Tone = "good" | "watch" | "risk";

function rate(visited: number, planned: number) {
  return planned > 0 ? Math.round(visited / planned * 100) : 0;
}

function statusLabel(status: Tone) {
  if (status === "good") return "Ổn";
  if (status === "watch") return "Theo dõi";
  return "Rủi ro";
}

function statusClass(status: Tone) {
  if (status === "good") return "status-good";
  if (status === "watch") return "status-watch";
  return "status-risk";
}

function sessionStatus(status: string) {
  if (status === "active") return "Đang mở";
  if (status === "done" || status === "completed") return "Đã chốt";
  if (status === "cancelled") return "Đã hủy";
  return "Chưa có";
}

function RouteCard({ route }: { route: McpShellRouteHealth }) {
  const progress = rate(route.visited, route.planned);
  return <article className="dashboard-route-card">
    <div className="dashboard-route-head">
      <div>
        <h3>{route.routeName}</h3>
        <small>{route.area} · {sessionStatus(route.sessionState)}</small>
      </div>
      <span className={`dashboard-status ${statusClass(route.status)}`}>{statusLabel(route.status)}</span>
    </div>
    <div className="dashboard-route-progress" aria-label={`Tiến độ ghé ${progress}%`}>
      <span style={{ width: `${Math.min(progress, 100)}%` }} />
    </div>
    <div className="dashboard-route-metrics">
      <span><b>{route.visited}/{route.planned}</b><small>Đã ghé</small></span>
      <span><b>{progress}%</b><small>Tiến độ</small></span>
      <span><b>{route.orders}</b><small>Đơn</small></span>
      <span><b>{route.followups}</b><small>Theo dõi</small></span>
    </div>
  </article>;
}

function ActionCard({ action }: { action: McpShellAction }) {
  return <article className="action-card dashboard-action-card">
    <div>
      <span className={`dashboard-priority priority-${action.priority}`}>Ưu tiên {action.priority === "high" ? "Cao" : "Vừa"}</span>
      <h3>{businessText(action.title)}</h3>
      <p>{businessText(action.description)}</p>
    </div>
    <strong>{businessOwner(action.owner)}</strong>
  </article>;
}

function LoadingState() {
  return <AppShell activeHref="/">
    <PageHeader eyebrow="Tổng quan" title="Điều hành hôm nay" subtitle="Đang mở dữ liệu đã lưu và cập nhật số liệu mới." />
    <section className="dashboard-section" aria-busy="true">
      <div className="empty-inline">Đang tải dữ liệu MCP...</div>
    </section>
  </AppShell>;
}

export function McpDashboardLocalPage() {
  const { snapshot, source, loading, refreshing, error, refresh } = useMcpShellSnapshot();
  if (!snapshot && loading) return <LoadingState />;
  if (!snapshot) {
    return <AppShell activeHref="/">
      <PageHeader eyebrow="Tổng quan" title="Điều hành hôm nay" subtitle="Chưa tải được dữ liệu MCP." />
      <section className="dashboard-section" role="alert">
        <div className="empty-inline">
          <strong>Chưa tải được dữ liệu</strong><br />
          Vui lòng thử lại.
          <div><button className="button" type="button" onClick={() => void refresh()}>Tải lại</button></div>
        </div>
      </section>
    </AppShell>;
  }

  const dashboard = snapshot.dashboard;
  const latestSession = dashboard.latestSession;
  const latestReport = dashboard.latestReport;
  const riskRoutes = dashboard.routeHealth.filter((item) => item.status === "risk").length;
  const watchRoutes = dashboard.routeHealth.filter((item) => item.status === "watch").length;
  const totals = dashboard.routeHealth.reduce((acc, item) => {
    acc.planned += item.planned;
    acc.visited += item.visited;
    acc.orders += item.orders;
    return acc;
  }, { planned: 0, visited: 0, orders: 0 });
  const visitRate = rate(totals.visited, totals.planned);
  const highActions = dashboard.actions.filter((item) => item.priority === "high").length;
  const reportRate = latestReport ? rate(latestReport.visited, latestReport.planned) : 0;

  const alerts = [
    latestReport && latestReport.planned > 0 && reportRate < 50
      ? { title: "Độ phủ phiên thấp", description: `Báo cáo mới nhất đã ghé ${latestReport.visited}/${latestReport.planned} điểm bán.`, href: "/reports" }
      : null,
    riskRoutes > 0
      ? { title: "Có tuyến cần ưu tiên", description: `${riskRoutes} tuyến đang ở mức rủi ro.`, href: "/routes" }
      : null,
    highActions > 0
      ? { title: "Có việc ưu tiên cao", description: `${highActions} việc cần xử lý trước.`, href: "/actions" }
      : null
  ].filter(Boolean) as Array<{ title: string; description: string; href: string }>;

  return <AppShell activeHref="/">
    <PageHeader
      eyebrow="Tổng quan"
      title="Điều hành hôm nay"
      subtitle="Nhìn nhanh phiên MCP, báo cáo mới nhất, việc cần xử lý và tình hình tuyến bán hàng."
    >
      <span className="badge">
        {source === "local" ? "Mở từ dữ liệu đã lưu" : refreshing ? "Đang cập nhật" : "Đã cập nhật"}
      </span>
    </PageHeader>

    <TodaySummaryCard
      eyebrow={latestSession?.status === "active" ? "Đang có phiên cần tiếp tục" : latestReport ? "Báo cáo phiên mới nhất" : "Tổng quan nhanh"}
      value={latestSession?.status === "active"
        ? latestSession.routeName
        : latestReport
          ? `${latestReport.visited}/${latestReport.planned || "-"}`
          : dashboard.routeHealth.length}
      description={latestSession
        ? `${latestSession.sessionDate} · ${latestSession.visitedCustomers}/${latestSession.plannedCustomers || "-"} điểm bán đã ghé · ${latestSession.orderCount} đơn`
        : latestReport
          ? `${latestReport.routeName} · ${latestReport.orders} đơn · ${latestReport.tests} lượt thử sản phẩm`
          : "Chưa có phiên gần đây."}
      pills={[
        { label: "tuyến", value: dashboard.routeHealth.length },
        { label: "đã ghé", value: totals.visited },
        { label: "cần xem", value: alerts.length }
      ]}
    />

    <section className="dashboard-command-grid" aria-label="Điều hành nhanh">
      <Link className={`dashboard-command-card command-${latestSession?.status === "active" ? "watch" : "good"}`} href="/mcp/sessions">
        <div className="dashboard-command-head"><span>Phiên gần nhất</span><strong className={`dashboard-status ${statusClass(latestSession?.status === "active" ? "watch" : "good")}`}>{latestSession ? sessionStatus(latestSession.status) : "Chưa có"}</strong></div>
        <div className="dashboard-command-main"><h3>{latestSession?.routeName || "Phiên MCP"}</h3><b>{latestSession ? `${latestSession.visitedCustomers}/${latestSession.plannedCustomers || "-"}` : "-"}</b><p>{latestSession ? `${latestSession.orderCount} đơn · ${latestSession.followupCount} việc theo dõi` : "Mở phiên từ tuyến bán hàng để bắt đầu tác nghiệp."}</p></div>
        <strong className="dashboard-command-cta">Xem phiên</strong>
      </Link>

      <Link className={`dashboard-command-card command-${latestReport ? "good" : "risk"}`} href="/reports">
        <div className="dashboard-command-head"><span>Báo cáo mới nhất</span><strong className={`dashboard-status ${statusClass(latestReport ? "good" : "risk")}`}>{latestReport ? "Đã có" : "Chưa có"}</strong></div>
        <div className="dashboard-command-main"><h3>{latestReport?.routeName || "Báo cáo phiên"}</h3><b>{latestReport ? `${latestReport.orders}/${latestReport.tests}` : "-"}</b><p>{latestReport ? `${latestReport.visited}/${latestReport.planned || "-"} điểm bán đã ghé · ${latestReport.followups} việc theo dõi` : "Chưa có báo cáo phiên gần đây."}</p></div>
        <strong className="dashboard-command-cta">Xem báo cáo</strong>
      </Link>

      <Link className={`dashboard-command-card command-${highActions ? "risk" : dashboard.actions.length ? "watch" : "good"}`} href="/actions">
        <div className="dashboard-command-head"><span>Việc cần xử lý</span><strong className={`dashboard-status ${statusClass(highActions ? "risk" : dashboard.actions.length ? "watch" : "good")}`}>{dashboard.actions.length} việc</strong></div>
        <div className="dashboard-command-main"><h3>{businessText(dashboard.actions[0]?.title, "Không có việc khẩn cấp")}</h3><b>{dashboard.actions.length}</b><p>{businessText(dashboard.actions[0]?.description, "Chưa có việc nổi bật từ dữ liệu hiện tại.")}</p></div>
        <strong className="dashboard-command-cta">Xem việc</strong>
      </Link>

      <Link className={`dashboard-command-card command-${riskRoutes ? "risk" : watchRoutes ? "watch" : "good"}`} href="/routes">
        <div className="dashboard-command-head"><span>Sức khỏe tuyến</span><strong className={`dashboard-status ${statusClass(riskRoutes ? "risk" : watchRoutes ? "watch" : "good")}`}>{riskRoutes + watchRoutes} cần xem</strong></div>
        <div className="dashboard-command-main"><h3>{riskRoutes ? `${riskRoutes} tuyến rủi ro` : watchRoutes ? `${watchRoutes} tuyến cần theo dõi` : "Tuyến ổn định"}</h3><b>{visitRate}%</b><p>{totals.visited}/{totals.planned || "-"} điểm bán đã ghé · {totals.orders} đơn.</p></div>
        <strong className="dashboard-command-cta">Xem tuyến</strong>
      </Link>
    </section>

    <FilterBar
      title="Trạng thái vận hành"
      filters={[
        { label: "Phiên", value: latestSession ? sessionStatus(latestSession.status) : "Chưa có" },
        { label: "Báo cáo", value: latestReport?.sessionDate || "Chưa có" },
        { label: "Độ phủ", value: `${visitRate}%` },
        { label: "Cảnh báo", value: String(alerts.length) }
      ]}
    />

    <CompactKpiStrip items={dashboard.kpis.map((item) => ({ label: item.label, value: item.value, hint: item.trend }))} />

    <section className="dashboard-section dashboard-alerts-section">
      <div className="dashboard-section-head"><h2>Cảnh báo cần xử lý</h2><span>{alerts.length ? `${alerts.length} cảnh báo` : "đang ổn"}</span></div>
      {alerts.length
        ? <div className="dashboard-alert-list">{alerts.map((item) => <Link className="dashboard-alert-card" href={item.href} key={item.title}><span className="dashboard-priority priority-medium">Cần xem</span><div><h3>{item.title}</h3><p>{item.description}</p></div><strong>Mở</strong></Link>)}</div>
        : <div className="empty-inline">Chưa có cảnh báo nổi bật từ dữ liệu hiện tại.</div>}
    </section>

    <section className="dashboard-section dashboard-actions-section">
      <div className="dashboard-section-head"><h2>Việc cần xử lý</h2><span>{dashboard.actions.length} việc</span></div>
      <div className="dashboard-action-list">{dashboard.actions.map((action) => <ActionCard action={action} key={action.title} />)}</div>
    </section>

    <section className="dashboard-section">
      <div className="dashboard-section-head"><h2>Sức khỏe tuyến</h2><span>{riskRoutes} rủi ro · {watchRoutes} theo dõi</span></div>
      <div className="dashboard-route-list">{dashboard.routeHealth.map((route) => <RouteCard route={route} key={`${route.routeName}-${route.sessionId || "none"}`} />)}</div>
    </section>

    {error ? <div className="empty-inline">Đang dùng dữ liệu đã lưu; lần cập nhật gần nhất chưa thành công.</div> : null}
  </AppShell>;
}
