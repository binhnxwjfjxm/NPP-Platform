import Link from "next/link";
import { withoutInternalSmokeRows } from "@/lib/data/internal-smoke";
import { loadRoutesData } from "@/lib/api/routes-data";
import { CompactKpiStrip } from "@/ui/cards/CompactKpiStrip";
import { TodaySummaryCard } from "@/ui/cards/TodaySummaryCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import { ExportMenu } from "@/features/exports/ExportLinks";
import styles from "./McpHome.module.css";

const DESKTOP_MODULES = [
  { href: "/routes", tone: "routes", icon: "◎", title: "Tuyến bán hàng", description: "Quản lý tuyến, điểm bán và vị trí trước khi bắt đầu đi thị trường.", cta: "Xem tuyến" },
  { href: "/visits", tone: "session", icon: "◉", title: "Đi tuyến hôm nay", description: "Mở hoặc tiếp tục phiên để ghi nhận kết quả tại từng điểm bán.", cta: "Mở phiên" },
  { href: "/mcp/sessions", tone: "session", icon: "▤", title: "Lịch sử phiên", description: "Tra cứu kết quả đi tuyến theo ngày, tuyến và trạng thái.", cta: "Xem lịch sử" },
  { href: "/mcp-setting", tone: "settings", icon: "⚙", title: "Cài đặt MCP", description: "Quản lý các lựa chọn nhanh dùng khi tác nghiệp ngoài thị trường.", cta: "Mở cài đặt" }
] as const;

function renderDesktopModule(item: (typeof DESKTOP_MODULES)[number]) {
  return <Link
    className={[styles.card, styles[item.tone]].join(" ")}
    href={item.href}
    key={item.href + "-" + item.title}
    prefetch
  >
    <span className={styles.icon} aria-hidden="true">{item.icon}</span>
    <span className={styles.content}>
      <strong>{item.title}</strong>
      <small>{item.description}</small>
    </span>
    <span className={styles.cta}>{item.cta}</span>
  </Link>;
}

export default async function McpPage() {
  const routesData = await loadRoutesData();
  const routes = withoutInternalSmokeRows(routesData.routes);
  const activeRoutes = routes.filter((route) => route.status === "active" || route.status === "watch").length;
  const pausedRoutes = routes.filter((route) => route.status === "paused").length;
  const plannedCustomers = routes.reduce((sum, route) => sum + Number(route.plannedCustomers || 0), 0);
  const visitedCustomers = routes.reduce((sum, route) => sum + Number(route.visitedCustomers || 0), 0);

  const mobileActions = [
    { href: "/routes", icon: "◎", title: "Tuyến bán hàng", meta: `${routes.length} tuyến đang quản lý` },
    { href: "/mcp/sessions", icon: "▤", title: "Lịch sử phiên", meta: "Xem lại các phiên đã thực hiện" },
    { href: "/mcp-setting", icon: "⚙", title: "Cài đặt MCP", meta: "Danh mục dùng khi tác nghiệp" }
  ] as const;

  return <AppShell activeHref="/mcp">
    <section className={styles.mobileFlow} data-mcp-mobile-flow="true" aria-label="Tác nghiệp MCP">
      <Link className={styles.primaryAction} data-mcp-primary-action="true" href="/visits" prefetch>
        <span className={styles.primaryIcon} aria-hidden="true">◉</span>
        <span className={styles.primaryCopy}>
          <strong>Đi tuyến hôm nay</strong>
          <small>{activeRoutes} tuyến có thể đi · {plannedCustomers} điểm bán</small>
        </span>
        <span className={styles.chevron} aria-hidden="true">›</span>
      </Link>

      <section className={styles.mobileStats} data-mcp-mobile-stats="true" aria-label="Tình hình tuyến">
        <div><strong>{activeRoutes}</strong><span>Có thể đi</span></div>
        <div><strong>{plannedCustomers}</strong><span>Điểm bán</span></div>
        <div><strong>{visitedCustomers}</strong><span>Đã ghé</span></div>
      </section>

      <nav className={styles.mobileActionList} aria-label="Quản lý MCP">
        {mobileActions.map((item) => <Link
          className={styles.mobileAction}
          data-mcp-mobile-action="true"
          href={item.href}
          key={item.href}
          prefetch
        >
          <span className={styles.mobileActionIcon} aria-hidden="true">{item.icon}</span>
          <span className={styles.mobileActionCopy}>
            <strong>{item.title}</strong>
            <small>{item.meta}</small>
          </span>
          <span className={styles.chevron} aria-hidden="true">›</span>
        </Link>)}
      </nav>

      <div className={styles.mobileUtility} aria-label="Xuất dữ liệu MCP">
        <span className={styles.mobileUtilityLabel}><span aria-hidden="true">⇩</span><strong>Xuất dữ liệu</strong></span>
        <ExportMenu label="Chọn" />
      </div>
    </section>

    <div className={styles.desktopFlow} data-mcp-desktop-flow="true">
      <PageHeader eyebrow="MCP" title="Quản lý đi thị trường" subtitle="Chuẩn bị tuyến, thực hiện phiên đi thị trường và theo dõi kết quả tại từng điểm bán.">
        <ExportMenu label="Xuất dữ liệu" primary />
      </PageHeader>
      <TodaySummaryCard
        eyebrow="Sẵn sàng đi tuyến"
        value={activeRoutes + " tuyến có thể đi"}
        description={plannedCustomers + " điểm bán trong tuyến · " + visitedCustomers + " lượt đã ghé theo dữ liệu hiện có"}
        pills={[
          { label: "tuyến", value: routes.length },
          { label: "đang hoạt động", value: activeRoutes },
          { label: "tạm dừng", value: pausedRoutes }
        ]}
      />
      <section className={styles.grid} aria-label="Chức năng MCP">{DESKTOP_MODULES.map(renderDesktopModule)}</section>
      <FilterBar
        title="Tình hình tuyến"
        filters={[
          { label: "Tổng tuyến", value: String(routes.length) },
          { label: "Có thể đi", value: String(activeRoutes) },
          { label: "Tạm dừng", value: String(pausedRoutes) },
          { label: "Điểm bán", value: String(plannedCustomers) }
        ]}
      />
      <CompactKpiStrip items={[
        { label: "Tuyến", value: routes.length, hint: "Đang quản lý" },
        { label: "Có thể đi", value: activeRoutes, hint: "Đang hoạt động hoặc cần theo dõi" },
        { label: "Điểm bán", value: plannedCustomers, hint: "Tổng điểm bán trong tuyến" },
        { label: "Đã ghé", value: visitedCustomers, hint: "Theo dữ liệu hiện có" }
      ]} />
    </div>
  </AppShell>;
}
