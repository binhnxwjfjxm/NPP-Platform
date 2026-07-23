"use client";

import type { McpDayData } from "@/features/mcp-day/mcp-day.types";
import type { RouteCustomersData } from "@/features/mcp/route-customers.types";
import type { RoutesData } from "@/features/routes/routes.types";
import { McpSessionAddCustomerButton } from "./McpSessionAddCustomerButton";
import { McpSessionCompactView } from "./McpSessionCompactView";
import { McpSessionReadonlyView } from "./McpSessionReadonlyView";
import { McpMasterView } from "./McpMasterView";
import { RouteCustomerExportMenu } from "./RouteCustomerExportMenu";
import { RouteCustomerLocationEnhancer } from "./RouteCustomerLocationEnhancer";

type MCPPageProps = {
  activeHref?: string;
  routesData: RoutesData;
  routeCustomersData: RouteCustomersData;
  mcpDayData?: McpDayData;
};

function locked(data: McpDayData) {
  return data.run.status === "done" || data.run.status === "completed" || data.run.status === "cancelled";
}

export function MCPPage({ activeHref = "/visits", routesData, mcpDayData, routeCustomersData }: MCPPageProps) {
  if (activeHref === "/visits") {
    if (!mcpDayData) throw new Error("mcpDayData is required for visits");
    if (locked(mcpDayData)) return <McpSessionReadonlyView activeHref={activeHref} mcpDayData={mcpDayData} />;
    return (
      <>
        <McpSessionCompactView activeHref={activeHref} routesData={routesData} mcpDayData={mcpDayData} routeCustomersData={routeCustomersData} />
        <McpSessionAddCustomerButton sessionId={mcpDayData.run.id} routeName={mcpDayData.run.routeName} />
      </>
    );
  }
  return <><RouteCustomerLocationEnhancer /><RouteCustomerExportMenu routesData={routesData} /><McpMasterView activeHref={activeHref} routesData={routesData} routeCustomersData={routeCustomersData} /></>;
}
