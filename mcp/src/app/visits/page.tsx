import { redirect } from "next/navigation";
import { MCPPage } from "@/features/mcp/MCPPage";
import { loadMcpDayData } from "@/lib/api/mcp-day-data";
import { loadRouteCustomersData, loadRoutesData } from "@/lib/api/routes-data";

type VisitsPageProps = {
  searchParams?: {
    routeId?: string;
    date?: string;
  };
};

export default async function Page({ searchParams }: VisitsPageProps) {
  const routeId = String(searchParams?.routeId || "").trim();
  const date = String(searchParams?.date || "").slice(0, 10);

  if (!routeId) {
    redirect("/mcp");
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
