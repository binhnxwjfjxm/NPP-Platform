import { AppShell } from "@/ui/shell/AppShell";
import { PageHeader } from "@/ui/layout/PageHeader";
import { McpSessionsManagerSafe } from "@/features/mcp/McpSessionsManagerSafe";
import { ExportMenu, buildExportLink } from "@/features/exports/ExportLinks";
import { loadMcpSessions } from "@/lib/mcp-sessions/load-mcp-sessions";

const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

function vnDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((item) => item.type === "year")?.value || "";
  const month = parts.find((item) => item.type === "month")?.value || "";
  const day = parts.find((item) => item.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

function today() {
  return vnDate();
}

function daysAgo(days: number) {
  return vnDate(-days);
}

export default async function McpSessionsPage({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = {
    dateFrom: String(searchParams.dateFrom || daysAgo(30)).slice(0, 10),
    dateTo: String(searchParams.dateTo || today()).slice(0, 10),
    routeId: String(searchParams.routeId || ""),
    status: String(searchParams.status || "")
  };
  const data = await loadMcpSessions(filters);
  const query = new URLSearchParams();
  if (filters.routeId) query.set("routeId", filters.routeId);
  if (filters.status) query.set("visitStatus", filters.status);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  return (
    <AppShell activeHref="/mcp/sessions">
      <div className="mcp-sessions-page">
        <PageHeader
          eyebrow="MCP"
          title="Phiên chạy tuyến"
          subtitle="Tra cứu các phiên đi tuyến theo ngày, tuyến và trạng thái."
        >
          <ExportMenu
            label="Xuất danh sách"
            primary
            groups={[
              {
                title: "Excel theo bộ lọc",
                links: [
                  buildExportLink(
                    "Danh sách điểm bán trong phiên",
                    `/api/backend/exports/mcp-sessions.csv${suffix}`,
                    "primary",
                    "Theo tuyến/trạng thái đang lọc"
                  ),
                  buildExportLink("Đơn hàng", "/api/backend/exports/orders.csv"),
                  buildExportLink("Báo cáo thị trường", "/api/backend/exports/market-reports.csv"),
                  buildExportLink("Việc cần theo dõi", "/api/backend/exports/followups.csv")
                ]
              }
            ]}
          />
        </PageHeader>
        <McpSessionsManagerSafe data={data} filters={filters} />
      </div>
    </AppShell>
  );
}
