import { redirect } from "next/navigation";
import { MCPPage } from "@/features/mcp/MCPPage";
import { loadMcpDayData } from "@/lib/api/mcp-day-data";
import { loadRouteCustomersData, loadRoutesData } from "@/lib/api/routes-data";
import { loadMcpSessions } from "@/lib/mcp-sessions/load-mcp-sessions";

const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

type VisitsPageProps = {
  searchParams?: {
    routeId?: string;
    date?: string;
  };
};

function cleanDate(value?: string) {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function vnToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((item) => item.type === "year")?.value || "";
  const month = parts.find((item) => item.type === "month")?.value || "";
  const day = parts.find((item) => item.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

function visitHref(routeId: string, date: string) {
  const query = new URLSearchParams({ routeId, date });
  return `/visits?${query.toString()}`;
}

export default async function Page({ searchParams }: VisitsPageProps) {
  const routeId = String(searchParams?.routeId || "").trim();
  const date = cleanDate(searchParams?.date);

  if (!routeId) {
    const sessionDate = date || vnToday();
    const activeSessions = await loadMcpSessions({
      dateFrom: sessionDate,
      dateTo: sessionDate,
      routeId: "",
      status: "active"
    });

    if (activeSessions.sessions.length === 1) {
      const active = activeSessions.sessions[0];
      redirect(visitHref(active.routeId, active.sessionDate));
    }

    if (activeSessions.sessions.length > 1) {
      const query = new URLSearchParams({
        dateFrom: sessionDate,
        dateTo: sessionDate,
        status: "active"
      });
      redirect(`/mcp/sessions?${query.toString()}`);
    }

    redirect("/routes");
  }

  const [routesData, mcpDayData, routeCustomersData] = await Promise.all([
    loadRoutesData(),
    loadMcpDayData({ routeId, date }),
    loadRouteCustomersData()
  ]);

  return (
    <MCPPage
      activeHref="/visits"
      routesData={routesData}
      mcpDayData={mcpDayData}
      routeCustomersData={routeCustomersData}
    />
  );
}
