import Link from "next/link";
import { createApiClient } from "@/lib/api/api-client";
import { withoutInternalSmokeRows } from "@/lib/data/internal-smoke";
import { CompactKpiStrip } from "@/ui/cards/CompactKpiStrip";
import { TodaySummaryCard } from "@/ui/cards/TodaySummaryCard";
import { FilterBar } from "@/ui/layout/FilterBar";
import { PageHeader } from "@/ui/layout/PageHeader";
import { AppShell } from "@/ui/shell/AppShell";
import { ExportMenu } from "@/features/exports/ExportLinks";
import styles from "./McpHome.module.css";

const MCP_MODULES = [
  { href: "/routes", tone: "routes", icon: "◎", title: "Tuyến bán hàng", description: "Quản lý tuyến, điểm bán và vị trí trước khi bắt đầu đi thị trường.", cta: "Xem tuyến" },
  { href: "/routes", tone: "session", icon: "◇", title: "Đi tuyến hôm nay", description: "Mở hoặc tiếp tục phiên để ghi đơn hàng, thử sản phẩm, báo cáo và việc cần theo dõi.", cta: "Mở phiên" },
  { href: "/mcp/sessions", tone: "session", icon: "▤", title: "Lịch sử phiên", description: "Tra cứu kết quả đi tuyến theo ngày, tuyến và trạng thái.", cta: "Xem lịch sử" },
  { href: "/mcp-setting", tone: "settings", icon: "⚙", title: "Cài đặt MCP", description: "Quản lý các lựa chọn nhanh dùng khi ghi nhận tình hình thị trường.", cta: "Mở cài đặt" }
] as const;

function renderModuleCard(item: (typeof MCP_MODULES)[number]) {
  return <Link className={[styles.card, styles[item.tone]].join(" ")} href={item.href} key={item.href + "-" + item.title} prefetch><span className={styles.icon} aria-hidden="true">{item.icon}</span><span className={styles.content}><strong>{item.title}</strong><small>{item.description}</small></span><span className={styles.cta}>{item.cta}</span></Link>;
}

export default async function McpPage() {
  const api = createApiClient();
  const routesResult = await api.getRoutesData();
  const routes = withoutInternalSmokeRows(routesResult.data.routes);
  const activeRoutes = routes.filter((route) => route.status === "active" || route.status === "watch").length;
  const pausedRoutes = routes.filter((route) => route.status === "paused").length;
  const plannedCustomers = routes.reduce((sum, route) => sum + Number(route.plannedCustomers || 0), 0);
  const visitedCustomers = routes.reduce((sum, route) => sum + Number(route.visitedCustomers || 0), 0);
  return <AppShell activeHref="/mcp">
    <PageHeader eyebrow="MCP" title="Quản lý đi thị trường" subtitle="Chuẩn bị tuyến, thực hiện phiên đi thị trường và theo dõi kết quả tại từng điểm bán."><ExportMenu label="Xuất dữ liệu" primary /></PageHeader>
    <TodaySummaryCard eyebrow="Sẵn sàng đi tuyến" value={activeRoutes + " tuyến có thể đi"} description={plannedCustomers + " điểm bán trong tuyến · " + visitedCustomers + " lượt đã ghé theo dữ liệu hiện có"} pills={[{ label: "tuyến", value: routes.length }, { label: "đang hoạt động", value: activeRoutes }, { label: "tạm dừng", value: pausedRoutes }]} />
    <section className={styles.grid} aria-label="Chức năng MCP">{MCP_MODULES.map(renderModuleCard)}</section>
    <FilterBar title="Tình hình tuyến" filters={[{ label: "Tổng tuyến", value: String(routes.length) }, { label: "Có thể đi", value: String(activeRoutes) }, { label: "Tạm dừng", value: String(pausedRoutes) }, { label: "Điểm bán", value: String(plannedCustomers) }]} />
    <CompactKpiStrip items={[{ label: "Tuyến", value: routes.length, hint: "Đang quản lý" }, { label: "Có thể đi", value: activeRoutes, hint: "Đang hoạt động hoặc cần theo dõi" }, { label: "Điểm bán", value: plannedCustomers, hint: "Tổng điểm bán trong tuyến" }, { label: "Đã ghé", value: visitedCustomers, hint: "Theo dữ liệu hiện có" }]} />
  </AppShell>;
}
