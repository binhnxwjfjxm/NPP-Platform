"use client";

import Link from "next/link";
import {
  McpButton,
  McpCard,
  McpPageHeader,
  McpStatePanel,
  McpStatusPill
} from "@/ui/foundation";
import { AppShell } from "@/ui/shell/AppShell";
import { businessOwner, businessText } from "@/lib/ui/business-text";
import { useMcpShellSnapshot } from "@/lib/local-read/use-mcp-shell";
import type { McpShellAction, McpShellRouteHealth } from "@/lib/local-read/mcp-shell-types";
import styles from "./TodayScreen.module.css";

type Tone = "success" | "warning" | "danger";

function rate(visited: number, planned: number) {
  return planned > 0 ? Math.round(visited / planned * 100) : 0;
}

function routeTone(status: McpShellRouteHealth["status"]): Tone {
  if (status === "good") return "success";
  if (status === "watch") return "warning";
  return "danger";
}

function routeStatusLabel(status: McpShellRouteHealth["status"]) {
  if (status === "good") return "Ổn";
  if (status === "watch") return "Theo dõi";
  return "Rủi ro";
}

function sessionStatus(status: string) {
  if (status === "active") return "Đang mở";
  if (status === "done" || status === "completed") return "Đã chốt";
  if (status === "cancelled") return "Đã hủy";
  return "Chưa có";
}

function RouteCard({ route }: { route: McpShellRouteHealth }) {
  const progress = rate(route.visited, route.planned);
  return (
    <article className={styles.routeCard}>
      <div className={styles.routeHead}>
        <div>
          <span>{route.area || "Chưa có khu vực"}</span>
          <h3>{route.routeName}</h3>
        </div>
        <McpStatusPill tone={routeTone(route.status)}>{routeStatusLabel(route.status)}</McpStatusPill>
      </div>
      <div className={styles.progress} aria-label={`Tiến độ ghé ${progress}%`}>
        <span style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
      <div className={styles.routeMetrics}>
        <span><strong>{route.visited}/{route.planned || "-"}</strong><small>Đã ghé</small></span>
        <span><strong>{route.orders}</strong><small>Đơn</small></span>
        <span><strong>{route.followups}</strong><small>Theo dõi</small></span>
      </div>
    </article>
  );
}

function ActionCard({ action }: { action: McpShellAction }) {
  return (
    <McpCard className={styles.actionCard}>
      <div>
        <McpStatusPill tone={action.priority === "high" ? "danger" : "warning"}>
          Ưu tiên {action.priority === "high" ? "Cao" : "Vừa"}
        </McpStatusPill>
        <h3>{businessText(action.title)}</h3>
        <p>{businessText(action.description)}</p>
      </div>
      <strong>{businessOwner(action.owner)}</strong>
    </McpCard>
  );
}

function TodayRouteAction() {
  return (
    <Link className={styles.primaryAction} data-client-navigation="true" href="/visits" prefetch={false}>
      <span aria-hidden="true">◎</span>
      <span><strong>Mở Đi tuyến</strong><small>Chọn tuyến hoặc phiên phù hợp</small></span>
      <b aria-hidden="true">›</b>
    </Link>
  );
}

function LoadingState() {
  return (
    <AppShell activeHref="/">
      <div className={styles.page} data-primary-screen="today">
        <McpPageHeader eyebrow="MCP Field" title="Hôm nay" description="Đang mở dữ liệu đã lưu và cập nhật số liệu mới." />
        <McpStatePanel
          title="Đang tải dữ liệu hôm nay"
          description="Ứng dụng ưu tiên dữ liệu đã lưu để mở nhanh, sau đó cập nhật số liệu mới."
          icon="↻"
          action={<TodayRouteAction />}
        />
      </div>
    </AppShell>
  );
}

export function McpDashboardLocalPage() {
  const { snapshot, source, loading, refreshing, error, refresh } = useMcpShellSnapshot();

  if (!snapshot && loading) return <LoadingState />;

  if (!snapshot) {
    return (
      <AppShell activeHref="/">
        <div className={styles.page} data-primary-screen="today">
          <McpPageHeader eyebrow="MCP Field" title="Hôm nay" description="Chưa tải được dữ liệu tác nghiệp." />
          <McpStatePanel
            title="Chưa tải được dữ liệu"
            description="Vui lòng thử lại. Không có thao tác nghiệp vụ nào được thực hiện khi dữ liệu chưa sẵn sàng."
            icon="!"
            action={
              <div className={styles.stateActions}>
                <McpButton variant="secondary" onClick={() => void refresh()}>Tải lại</McpButton>
                <TodayRouteAction />
              </div>
            }
          />
        </div>
      </AppShell>
    );
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
    acc.followups += item.followups;
    return acc;
  }, { planned: 0, visited: 0, orders: 0, followups: 0 });
  const visitRate = rate(totals.visited, totals.planned);
  const highActions = dashboard.actions.filter((item) => item.priority === "high").length;
  const reportRate = latestReport ? rate(latestReport.visited, latestReport.planned) : 0;
  const activeSession = latestSession?.status === "active";

  const alerts = [
    latestReport && latestReport.planned > 0 && reportRate < 50
      ? { title: "Độ phủ phiên thấp", description: `Báo cáo mới nhất đã ghé ${latestReport.visited}/${latestReport.planned} điểm bán.`, href: "/reports", tone: "danger" as const }
      : null,
    riskRoutes > 0
      ? { title: "Có tuyến cần ưu tiên", description: `${riskRoutes} tuyến đang ở mức rủi ro.`, href: "/routes", tone: "warning" as const }
      : null,
    highActions > 0
      ? { title: "Có việc ưu tiên cao", description: `${highActions} việc cần xử lý trước.`, href: "/plans", tone: "danger" as const }
      : null
  ].filter(Boolean) as Array<{ title: string; description: string; href: string; tone: Tone }>;

  return (
    <AppShell activeHref="/">
      <div className={styles.page} data-primary-screen="today">
        <McpPageHeader
          eyebrow="MCP Field"
          title="Hôm nay"
          description="Tuyến, phiên đang làm, đơn hàng và việc cần xử lý trong ngày."
          actions={
            <McpStatusPill tone={source === "local" ? "warning" : "success"}>
              {source === "local" ? "Đang dùng dữ liệu đã lưu" : refreshing ? "Đang cập nhật" : "Đã cập nhật"}
            </McpStatusPill>
          }
        />

        <McpCard className={styles.hero}>
          <div className={styles.heroCopy}>
            <div>
              <span className={styles.heroEyebrow}>{activeSession ? "Phiên đang mở" : latestReport ? "Báo cáo gần nhất" : "Tổng quan hôm nay"}</span>
              <h2>{activeSession ? latestSession.routeName : latestReport?.routeName || "Chưa có phiên đang mở"}</h2>
              <p>
                {latestSession
                  ? `${latestSession.sessionDate} · ${latestSession.visitedCustomers}/${latestSession.plannedCustomers || "-"} điểm bán đã ghé · ${latestSession.orderCount} đơn`
                  : latestReport
                    ? `${latestReport.sessionDate} · ${latestReport.visited}/${latestReport.planned || "-"} điểm bán đã ghé · ${latestReport.orders} đơn`
                    : "Mở Đi tuyến để bắt đầu phiên tác nghiệp hôm nay."}
              </p>
            </div>
            <Link className={styles.primaryAction} data-client-navigation="true" href="/visits" prefetch={false}>
              <span aria-hidden="true">◎</span>
              <span><strong>{activeSession ? "Tiếp tục đi tuyến" : "Mở Đi tuyến"}</strong><small>{activeSession ? sessionStatus(latestSession.status) : "Chọn tuyến hoặc phiên phù hợp"}</small></span>
              <b aria-hidden="true">›</b>
            </Link>
          </div>

          <div className={styles.heroMetrics}>
            <span><strong>{totals.visited}/{totals.planned || "-"}</strong><small>Điểm bán đã ghé</small></span>
            <span><strong>{totals.orders}</strong><small>Đơn hàng</small></span>
            <span><strong>{totals.followups}</strong><small>Việc theo dõi</small></span>
            <span><strong>{visitRate}%</strong><small>Tiến độ</small></span>
          </div>
        </McpCard>

        <section className={styles.kpiGrid} aria-label="Chỉ số hôm nay">
          {dashboard.kpis.slice(0, 4).map((item) => (
            <McpCard className={styles.kpiCard} key={item.label}>
              <span>{businessText(item.label)}</span>
              <strong>{item.value}</strong>
              <small>{businessText(item.trend || item.hint)}</small>
            </McpCard>
          ))}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div><span>Cần chú ý</span><h2>Cảnh báo cần xử lý</h2></div>
            <McpStatusPill tone={alerts.length ? "warning" : "success"}>{alerts.length ? `${alerts.length} cảnh báo` : "Đang ổn"}</McpStatusPill>
          </div>
          {alerts.length ? (
            <div className={styles.alertList}>
              {alerts.map((item) => (
                <Link className={styles.alertCard} href={item.href} key={item.title}>
                  <McpStatusPill tone={item.tone}>Cần xem</McpStatusPill>
                  <span><strong>{item.title}</strong><small>{item.description}</small></span>
                  <b aria-hidden="true">›</b>
                </Link>
              ))}
            </div>
          ) : (
            <McpStatePanel title="Chưa có cảnh báo nổi bật" description="Dữ liệu phiên, tuyến và công việc hiện không có cảnh báo cần ưu tiên." icon="✓" />
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div><span>Hôm nay</span><h2>Việc cần xử lý</h2></div>
            <McpStatusPill tone={highActions ? "danger" : dashboard.actions.length ? "warning" : "success"}>
              {dashboard.actions.length} việc
            </McpStatusPill>
          </div>
          {dashboard.actions.length ? (
            <div className={styles.actionList}>{dashboard.actions.map((action) => <ActionCard action={action} key={action.title} />)}</div>
          ) : (
            <McpStatePanel title="Không có việc cần xử lý" description="Chưa có việc theo dõi nổi bật từ dữ liệu hiện tại." icon="✓" />
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div><span>Tuyến</span><h2>Tình hình tuyến</h2></div>
            <McpStatusPill tone={riskRoutes ? "danger" : watchRoutes ? "warning" : "success"}>
              {riskRoutes ? `${riskRoutes} rủi ro` : watchRoutes ? `${watchRoutes} theo dõi` : "Ổn định"}
            </McpStatusPill>
          </div>
          {dashboard.routeHealth.length ? (
            <div className={styles.routeList}>{dashboard.routeHealth.map((route) => <RouteCard route={route} key={`${route.routeName}-${route.sessionId || "none"}`} />)}</div>
          ) : (
            <McpStatePanel title="Chưa có dữ liệu tuyến" description="Dữ liệu tuyến sẽ hiển thị sau khi được đồng bộ." icon="◎" />
          )}
        </section>

        {error ? <p className={styles.syncNote} role="status">Đang dùng dữ liệu đã lưu; lần cập nhật gần nhất chưa thành công.</p> : null}
      </div>
    </AppShell>
  );
}
