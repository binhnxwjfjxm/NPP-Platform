import type { DashboardActionDto, DashboardRouteHealthDto } from "@/lib/api/api.types";
import { restRows } from "@/lib/export/supabase-rest";
import { CompactKpiStrip } from "@/ui/cards/CompactKpiStrip";
import { TodaySummaryCard } from "@/ui/cards/TodaySummaryCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import { SourceBadge } from "@/ui/status/SourceBadge";
import { businessOwner, businessText, isTechnicalSourceText } from "@/lib/ui/business-text";
import {
  compareSessionsNewestFirst,
  derivePersistedRouteOverview,
  vietnamBusinessDate,
  type DashboardReportRow,
  type DashboardRouteRow,
  type DashboardSessionRow,
  type PersistedRouteOverview
} from "./persisted-overview";

type Row = Record<string, unknown>;
type RestOptions = { select?: string; order?: string; limit?: number; offset?: number; filters?: Record<string, string | number | boolean | null | undefined> };
type HomeCard = {
  href: string;
  eyebrow: string;
  title: string;
  value: string | number;
  description: string;
  meta: string[];
  cta: string;
  tone: "good" | "watch" | "risk";
};

type HomeAlert = {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  href: string;
  cta: string;
};

type HomeFacts = {
  routes: DashboardRouteRow[];
  sessions: DashboardSessionRow[];
  reports: DashboardReportRow[];
};

type OperationalOverview = {
  kpis: { label: string; value: string | number; hint: string; trend: string }[];
  routeHealth: (DashboardRouteHealthDto & { sessionId: string | null; sessionState: string; followups: number })[];
  actions: DashboardActionDto[];
  insights: { label: string; value: string }[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function num(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateText(value: unknown) {
  return text(value).slice(0, 10) || "-";
}

function getStatusLabel(status: "good" | "watch" | "risk") {
  if (status === "good") return "Ổn";
  if (status === "watch") return "Theo dõi";
  return "Rủi ro";
}

function getPriorityLabel(priority: "high" | "medium" | "low") {
  if (priority === "high") return "Cao";
  if (priority === "medium") return "Vừa";
  return "Thấp";
}

function getStatusClass(status: "good" | "watch" | "risk") {
  if (status === "good") return "status-good";
  if (status === "watch") return "status-watch";
  return "status-risk";
}

function sessionStatusText(status: string) {
  if (status === "active") return "Đang mở";
  if (status === "done" || status === "completed") return "Đã chốt";
  if (status === "cancelled") return "Đã hủy";
  if (status === "none") return "Chưa có phiên";
  return "Không rõ trạng thái";
}

function visitRate(visited: number, planned: number) {
  return planned > 0 ? Math.round((visited / planned) * 100) : 0;
}

function reportOverview(row?: Row) {
  const direct = row?.overview;
  if (direct && typeof direct === "object") return direct as Row;
  const sections = row?.sections;
  if (sections && typeof sections === "object") {
    const overview = (sections as Row).overview;
    if (overview && typeof overview === "object") return overview as Row;
  }
  return {} as Row;
}

function sessionMatchesReport(session?: Row, report?: Row) {
  return Boolean(session?.id && report?.session_id && text(session.id) === text(report.session_id));
}

function metricsFromSession(session?: Row, report?: Row) {
  const overview = sessionMatchesReport(session, report) ? reportOverview(report) : {};
  const planned = num(overview.planned) || num(session?.planned_customers);
  const visited = num(overview.visited) || num(session?.visited_customers);
  return {
    planned,
    visited,
    pending: num(overview.pending) || Math.max(planned - visited - num(overview.skipped), 0),
    skipped: num(overview.skipped),
    orders: num(overview.orders) || num(session?.order_count),
    tests: num(overview.tests) || num(session?.test_count),
    observations: num(overview.observations) || num(session?.report_count),
    followups: num(overview.followups) || num(session?.followup_count)
  };
}

async function allRows<T>(table: string, options: RestOptions) {
  const pageSize = 500;
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await restRows<T>(table, { ...options, limit: pageSize, offset });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function loadHomeFacts(): Promise<HomeFacts> {
  const [routes, sessions, reports] = await Promise.all([
    allRows<DashboardRouteRow>("mcp_routes", {
      select: "id,route_name,area,active",
      order: "id.asc",
      filters: { active: true }
    }),
    allRows<DashboardSessionRow>("mcp_route_sessions", {
      select: "id,route_id,route_name,session_date,sales,status,planned_customers,visited_customers,order_count,test_count,report_count,followup_count,created_at,updated_at",
      order: "session_date.desc,updated_at.desc,id.desc"
    }),
    allRows<DashboardReportRow>("mcp_session_reports", {
      select: "id,session_id,route_id,route_name,session_date,sales,status,kpis,overview,sections,summary_text,snapshot_source,snapshot_at,created_at,updated_at",
      order: "session_date.desc,snapshot_at.desc,id.desc"
    })
  ]);
  return { routes, sessions, reports };
}

function buildOperationalOverview(facts: HomeFacts): OperationalOverview & { persistedRoutes: PersistedRouteOverview[] } {
  const persistedRoutes = derivePersistedRouteOverview(facts.routes, facts.sessions, facts.reports);
  const routeHealth = persistedRoutes.map((route) => {
    return {
      routeName: route.routeName,
      area: route.area,
      planned: route.planned,
      visited: route.visited,
      orders: route.orders,
      status: route.health,
      sessionId: route.sessionId,
      sessionState: route.sessionState,
      followups: route.followups
    };
  });
  const totals = persistedRoutes.reduce((result, route) => {
    result.planned += route.planned;
    result.visited += route.visited;
    result.orders += route.orders;
    result.followups += route.followups;
    return result;
  }, { planned: 0, visited: 0, orders: 0, followups: 0 });
  const actions: DashboardActionDto[] = persistedRoutes.flatMap((route) => {
    if (route.health === "good") return [];
    return [{
      title: route.sessionState === "none" ? `Lập phiên cho ${route.routeName}` : route.sessionState === "cancelled" ? `Kiểm tra phiên đã hủy tại ${route.routeName}` : route.health === "risk" ? `Kiểm tra độ phủ ${route.routeName}` : `Hoàn tất khách chưa ghé tại ${route.routeName}`,
      description: `${route.visited}/${route.planned || "-"} khách đã ghé trong phiên gần nhất.`,
      priority: route.health === "risk" ? "high" : "medium",
      owner: "Phụ trách tuyến"
    } satisfies DashboardActionDto];
  });

  return {
    kpis: [
      { label: "Tuyến cần điều hành", value: facts.routes.length, hint: "Dữ liệu đã lưu", trend: "Dữ liệu đã lưu" },
      { label: "Khách đã ghé", value: totals.visited, hint: "Theo phiên MCP", trend: `${visitRate(totals.visited, totals.planned)}% độ phủ` },
      { label: "Đơn đã ghi", value: totals.orders, hint: "Theo phiên MCP", trend: "Theo phiên MCP" },
      { label: "Việc theo dõi", value: totals.followups, hint: "Theo phiên MCP", trend: "Theo phiên MCP" }
    ],
    routeHealth,
    actions,
    insights: [
      { label: "Tỷ lệ ghé thăm", value: `${visitRate(totals.visited, totals.planned)}%` },
      { label: "Tuyến có dữ liệu", value: String(routeHealth.length) }
    ],
    persistedRoutes
  };
}

function renderRouteCard(route: DashboardRouteHealthDto & { sessionId: string | null; sessionState: string; followups: number }) {
  const rate = visitRate(route.visited, route.planned);

  return (
    <article className="dashboard-route-card" key={route.routeName}>
      <div className="dashboard-route-head">
        <div>
          <h3>{route.routeName}</h3>
          <small>{route.area} · {sessionStatusText(route.sessionState)}{route.sessionId ? ` · ${route.sessionId}` : ""}</small>
        </div>
        <span className={`dashboard-status ${getStatusClass(route.status)}`}>{getStatusLabel(route.status)}</span>
      </div>
      <div className="dashboard-route-progress" aria-label={`Tiến độ ghé ${rate}%`}>
        <span style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <div className="dashboard-route-metrics">
        <span>
          <b>{route.visited}/{route.planned}</b>
          <small>Đã ghé</small>
        </span>
        <span>
          <b>{rate}%</b>
          <small>Tiến độ</small>
        </span>
        <span>
          <b>{route.orders}</b>
          <small>Đơn</small>
        </span>
        <span>
          <b>{route.followups}</b>
          <small>Theo dõi</small>
        </span>
      </div>
    </article>
  );
}

function renderAction(action: DashboardActionDto) {
  return (
    <article className="action-card dashboard-action-card" key={action.title}>
      <div>
        <span className={`dashboard-priority priority-${action.priority}`}>Ưu tiên {getPriorityLabel(action.priority)}</span>
        <h3>{businessText(action.title)}</h3>
        <p>{businessText(action.description)}</p>
      </div>
      <strong>{businessOwner(action.owner)}</strong>
    </article>
  );
}

function renderHomeCard(item: HomeCard) {
  return (
    <a className={`dashboard-command-card command-${item.tone}`} href={item.href} key={item.eyebrow}>
      <div className="dashboard-command-head">
        <span>{item.eyebrow}</span>
        <strong className={`dashboard-status ${getStatusClass(item.tone)}`}>{getStatusLabel(item.tone)}</strong>
      </div>
      <div className="dashboard-command-main">
        <h3>{item.title}</h3>
        <b>{item.value}</b>
        <p>{item.description}</p>
      </div>
      <div className="dashboard-command-meta">
        {item.meta.map((meta) => <small key={meta}>{meta}</small>)}
      </div>
      <strong className="dashboard-command-cta">{item.cta}</strong>
    </a>
  );
}

function renderAlert(alert: HomeAlert) {
  return (
    <a className="dashboard-alert-card" href={alert.href} key={alert.title}>
      <span className={`dashboard-priority priority-${alert.priority}`}>Ưu tiên {getPriorityLabel(alert.priority)}</span>
      <div>
        <h3>{alert.title}</h3>
        <p>{alert.description}</p>
      </div>
      <strong>{alert.cta}</strong>
    </a>
  );
}

export async function DashboardPage() {
  let homeFacts: HomeFacts;
  try {
    homeFacts = await loadHomeFacts();
  } catch {
    return (
      <AppShell activeHref="/">
        <PageHeader eyebrow="Tổng quan" title="Điều hành hôm nay" subtitle="Nhìn nhanh phiên MCP, báo cáo mới nhất, việc cần xử lý và tình hình tuyến bán hàng." />
        <section className="dashboard-section" role="alert">
          <div className="empty-inline"><strong>Không tải được dữ liệu</strong><br />Vui lòng tải lại trang hoặc thử lại sau.</div>
        </section>
      </AppShell>
    );
  }
  const dashboard = buildOperationalOverview(homeFacts);
  const primaryKpi = dashboard.kpis[0];
  const totalRoutes = dashboard.routeHealth.length;
  const riskRoutes = dashboard.routeHealth.filter((route) => route.status === "risk").length;
  const watchRoutes = dashboard.routeHealth.filter((route) => route.status === "watch").length;
  const totalOrders = dashboard.routeHealth.reduce((sum, route) => sum + route.orders, 0);
  const totalPlanned = dashboard.routeHealth.reduce((sum, route) => sum + route.planned, 0);
  const totalVisited = dashboard.routeHealth.reduce((sum, route) => sum + route.visited, 0);
  const totalVisitRate = visitRate(totalVisited, totalPlanned);
  const sortedSessions = [...homeFacts.sessions].sort(compareSessionsNewestFirst);
  const businessDate = vietnamBusinessDate();
  const activeSession = sortedSessions.find((session) => text(session.status) === "active" && text(session.session_date) === businessDate);
  const latestSession = activeSession || sortedSessions[0];
  const matchingReports = latestSession ? homeFacts.reports.filter((report) => text(report.session_id) === text(latestSession.id)) : [];
  const latestReport = matchingReports.sort((left, right) => text(right.snapshot_at || right.updated_at || right.id).localeCompare(text(left.snapshot_at || left.updated_at || left.id)))[0];
  const persistedLatest = dashboard.persistedRoutes.find((route) => route.sessionId === text(latestSession?.id));
  const rawSessionMetrics = metricsFromSession(latestSession, latestReport);
  const sessionMetrics = persistedLatest ? {
    ...rawSessionMetrics,
    planned: persistedLatest.planned,
    visited: persistedLatest.visited,
    pending: Math.max(persistedLatest.planned - persistedLatest.visited - rawSessionMetrics.skipped, 0),
    orders: persistedLatest.orders,
    followups: persistedLatest.followups
  } : rawSessionMetrics;
  const latestReportOverview = reportOverview(latestReport);
  const reportVisited = num(latestReportOverview.visited);
  const reportPlanned = num(latestReportOverview.planned);
  const reportOrders = persistedLatest?.reportId === text(latestReport?.id) ? persistedLatest.orders : num(latestReportOverview.orders);
  const reportTests = num(latestReportOverview.tests);
  const reportFollowups = persistedLatest?.reportId === text(latestReport?.id) ? persistedLatest.followups : num(latestReportOverview.followups);
  const reportObservations = num(latestReportOverview.observations);
  const highActions = dashboard.actions.filter((action) => action.priority === "high").length;
  const hasActiveSession = Boolean(activeSession?.id);
  const hasLatestReport = Boolean(latestReport?.id);
  const latestSessionStatus = text(latestSession?.status) || "active";
  const latestSessionTitle = latestSession?.id ? `${text(latestSession.route_name) || "Phiên MCP"} · ${dateText(latestSession.session_date)}` : "Chưa thấy phiên MCP gần đây";
  const latestReportTitle = latestReport?.id ? `${text(latestReport.route_name) || "MCP"} · ${dateText(latestReport.session_date || latestReport.snapshot_at)}` : "Chưa có báo cáo phiên đã chốt";

  const homeCards: HomeCard[] = [
    {
      href: "/mcp/sessions",
      eyebrow: hasActiveSession ? "Phiên đang mở" : "Phiên gần nhất",
      title: latestSessionTitle,
      value: latestSession?.id ? `${sessionMetrics.visited}/${sessionMetrics.planned || "-"}` : `${totalVisited}/${totalPlanned || "-"}`,
      description: latestSession?.id ? `${sessionStatusText(latestSessionStatus)} · ${sessionMetrics.orders} đơn · ${sessionMetrics.tests} lượt thử sản phẩm · ${sessionMetrics.observations} ghi nhận thị trường` : "Mở phiên từ tuyến bán hàng để bắt đầu ghi đơn, thử sản phẩm và ghi nhận thị trường.",
      meta: latestSession?.id ? [`${sessionMetrics.pending} chờ`, `${sessionMetrics.followups} việc theo dõi`, businessOwner(latestSession.sales)] : [`${totalRoutes} tuyến`, `${totalVisitRate}% ghé`, "Chưa có phiên"],
      cta: hasActiveSession ? "Tiếp tục phiên" : "Xem phiên",
      tone: hasActiveSession ? "watch" : latestSession?.id ? "good" : "risk"
    },
    {
      href: "/reports",
      eyebrow: "Báo cáo phiên mới nhất",
      title: latestReportTitle,
      value: hasLatestReport ? `${reportOrders}/${reportTests}` : "-",
      description: hasLatestReport ? `${reportVisited}/${reportPlanned || "-"} khách đã ghé · ${reportObservations} ghi nhận thị trường · ${reportFollowups} việc theo dõi` : "Chưa có báo cáo phiên để quản lý đọc nhanh hoặc đưa vào AI phân tích.",
      meta: hasLatestReport ? ["đơn / thử sản phẩm", `${reportPlanned ? visitRate(reportVisited, reportPlanned) : 0}% độ phủ`, "Báo cáo đã chốt"] : ["cần chốt phiên", "chưa có báo cáo", "chưa có phân tích"],
      cta: hasLatestReport ? "Xem báo cáo" : "Mở báo cáo",
      tone: hasLatestReport ? (reportPlanned > 0 && visitRate(reportVisited, reportPlanned) < 50 ? "watch" : "good") : "risk"
    },
    {
      href: "/actions",
      eyebrow: "Việc cần xử lý",
      title: businessText(dashboard.actions[0]?.title, "Không có việc khẩn cấp"),
      value: dashboard.actions.length,
      description: businessText(dashboard.actions[0]?.description, "Chưa có cảnh báo vận hành nổi bật từ dữ liệu hiện tại."),
      meta: [`${highActions} ưu tiên cao`, `${dashboard.actions.length - highActions} còn lại`, "theo dữ liệu hiện tại"],
      cta: dashboard.actions.length ? "Xem việc" : "Mở danh sách",
      tone: highActions ? "risk" : dashboard.actions.length ? "watch" : "good"
    },
    {
      href: "/routes",
      eyebrow: "Sức khỏe tuyến",
      title: riskRoutes ? `${riskRoutes} tuyến rủi ro` : watchRoutes ? `${watchRoutes} tuyến cần theo dõi` : "Tuyến ổn định",
      value: `${riskRoutes + watchRoutes}`,
      description: `${totalVisited}/${totalPlanned || "-"} khách đã ghé · ${totalOrders} đơn từ sức khỏe tuyến hiện tại.`,
      meta: [`${riskRoutes} rủi ro`, `${watchRoutes} theo dõi`, `${totalVisitRate}% tiến độ`],
      cta: "Xem tuyến",
      tone: riskRoutes ? "risk" : watchRoutes ? "watch" : "good"
    }
  ];

  const alerts: HomeAlert[] = [
    !hasLatestReport && latestSession?.id && ["done", "completed"].includes(latestSessionStatus) ? {
      title: "Phiên đã chốt nhưng chưa có báo cáo",
      description: `${text(latestSession.route_name) || "Phiên MCP"} ngày ${dateText(latestSession.session_date)} cần tạo lại báo cáo để quản lý có dữ liệu đầy đủ.`,
      priority: "high",
      href: "/mcp/sessions",
      cta: "Kiểm tra"
    } : null,
    hasLatestReport && reportPlanned > 0 && visitRate(reportVisited, reportPlanned) < 50 ? {
      title: "Độ phủ phiên thấp",
      description: `Báo cáo mới nhất chỉ ghé ${reportVisited}/${reportPlanned} khách. Cần kiểm tra lý do chưa ghé và lịch theo dõi cho phiên sau.`,
      priority: "high",
      href: "/reports",
      cta: "Xem báo cáo"
    } : null,
    reportTests > 0 && reportFollowups === 0 ? {
      title: "Có lượt thử sản phẩm nhưng chưa có việc theo dõi",
      description: "Báo cáo mới nhất có thử sản phẩm nhưng chưa tạo việc theo dõi. Nên bổ sung việc theo dõi để không mất tín hiệu mua hàng.",
      priority: "medium",
      href: "/reports",
      cta: "Xem kết quả thử"
    } : null,
    riskRoutes > 0 ? {
      title: "Có tuyến rủi ro",
      description: `${riskRoutes} tuyến đang ở trạng thái rủi ro. Ưu tiên kiểm tra độ phủ, đơn và khách chưa ghé.`,
      priority: "medium",
      href: "/routes",
      cta: "Xem tuyến"
    } : null,
    highActions > 0 ? {
      title: "Có việc ưu tiên cao",
      description: `${highActions} việc đang cần xử lý trước. Mở danh sách việc để tránh sót việc theo dõi hoặc đơn chưa xác nhận.`,
      priority: "high",
      href: "/actions",
      cta: "Xem việc"
    } : null
  ].filter(Boolean) as HomeAlert[];

  return (
    <AppShell activeHref="/">
      <PageHeader
        eyebrow="Tổng quan"
        title="Điều hành hôm nay"
        subtitle="Nhìn nhanh phiên MCP, báo cáo mới nhất, việc cần xử lý và tình hình tuyến bán hàng."
      >
        <SourceBadge source="api" />
      </PageHeader>

      <TodaySummaryCard
        eyebrow={hasActiveSession ? "Đang có phiên cần tiếp tục" : hasLatestReport ? "Báo cáo phiên mới nhất" : "Tổng quan nhanh"}
        value={hasActiveSession ? text(activeSession?.route_name) || "Phiên MCP" : hasLatestReport ? `${reportVisited}/${reportPlanned || "-"}` : primaryKpi?.value ?? "-"}
        description={hasActiveSession ? `${dateText(activeSession?.session_date)} · ${sessionMetrics.visited}/${sessionMetrics.planned || "-"} khách đã ghé · ${sessionMetrics.orders} đơn · ${sessionMetrics.tests} lượt thử sản phẩm` : hasLatestReport ? `${latestReportTitle} · ${reportOrders} đơn · ${reportTests} lượt thử sản phẩm · ${reportObservations} ghi nhận thị trường` : primaryKpi ? `${primaryKpi.label} · ${primaryKpi.hint}` : "Đang chờ dữ liệu"}
        pills={[
          { label: "phiên", value: hasActiveSession ? "mở" : homeFacts.sessions.length },
          { label: "báo cáo", value: homeFacts.reports.length },
          { label: "cần xem", value: alerts.length }
        ]}
      />

      <section className="dashboard-command-grid" aria-label="Điều hành nhanh">
        {homeCards.map(renderHomeCard)}
      </section>

      <FilterBar
        title="Trạng thái vận hành"
        filters={[
          { label: "Phiên", value: hasActiveSession ? "Đang mở" : latestSession?.id ? sessionStatusText(latestSessionStatus) : "Chưa có" },
          { label: "Báo cáo mới nhất", value: hasLatestReport ? dateText(latestReport?.session_date || latestReport?.snapshot_at) : "Chưa có" },
          { label: "Độ phủ", value: hasLatestReport && reportPlanned ? `${visitRate(reportVisited, reportPlanned)}%` : `${totalVisitRate}%` },
          { label: "Cảnh báo", value: String(alerts.length) }
        ]}
      />

      <CompactKpiStrip items={dashboard.kpis.map((item) => ({ label: businessText(item.label), value: item.value, hint: businessText(item.trend) }))} />

      <section className="dashboard-section dashboard-alerts-section">
        <div className="dashboard-section-head">
          <h2>Cảnh báo cần xử lý</h2>
          <span>{alerts.length ? `${alerts.length} cảnh báo` : "đang ổn"}</span>
        </div>
        {alerts.length ? <div className="dashboard-alert-list">{alerts.map(renderAlert)}</div> : <div className="empty-inline">Chưa có cảnh báo nổi bật từ phiên, báo cáo và tuyến hiện tại.</div>}
      </section>

      <section className="dashboard-section dashboard-actions-section">
        <div className="dashboard-section-head">
          <h2>Việc cần xử lý</h2>
          <span>{dashboard.actions.length} việc</span>
        </div>
        <div className="dashboard-action-list">{dashboard.actions.map(renderAction)}</div>
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-head">
          <h2>Sức khỏe tuyến</h2>
          <span>{riskRoutes} rủi ro · {watchRoutes} theo dõi</span>
        </div>
        <div className="dashboard-route-list">{dashboard.routeHealth.map(renderRouteCard)}</div>
      </section>

      <section className="dashboard-insight-strip" aria-label="Chỉ số phụ">
        {dashboard.insights.filter((item) => !isTechnicalSourceText(`${item.label} ${item.value}`)).map((item) => (
          <div className="metric-row" key={item.label}>
            <span>{businessText(item.label)}</span>
            <strong>{businessText(item.value)}</strong>
          </div>
        ))}
      </section>
    </AppShell>
  );
}
