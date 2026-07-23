"use client";

import type { McpDayData } from "@/features/mcp-day/mcp-day.types";
import type { RouteCustomersData } from "@/features/mcp/route-customers.types";
import type { RoutesData } from "@/features/routes/routes.types";
import { McpSessionCompactView } from "./McpSessionCompactView";
import { McpSessionReadonlyView } from "./McpSessionReadonlyView";
import { McpMasterView } from "./McpMasterView";
import { RouteCustomerLocationEnhancer } from "./RouteCustomerLocationEnhancer";
import { ReportQuickFormEnhancer } from "./ReportQuickFormEnhancer";

type MCPPageProps = {
  activeHref?: string;
  routesData: RoutesData;
  routeCustomersData: RouteCustomersData;
  mcpDayData?: McpDayData;
};

function sessionIsLocked(data: McpDayData) {
  return data.run.status === "done" || data.run.status === "completed" || data.run.status === "cancelled";
}

export function MCPPage({ activeHref = "/visits", routesData, mcpDayData, routeCustomersData }: MCPPageProps) {
  if (activeHref === "/visits") {
    if (!mcpDayData) {
      throw new Error("mcpDayData is required for /visits");
    }

    if (sessionIsLocked(mcpDayData)) {
      return <McpSessionReadonlyView activeHref={activeHref} mcpDayData={mcpDayData} />;
    }

    return <><ReportQuickFormEnhancer /><McpSessionCompactView activeHref={activeHref} routesData={routesData} mcpDayData={mcpDayData} routeCustomersData={routeCustomersData} /></>;
  }

  return <><RouteCustomerLocationEnhancer /><McpMasterView activeHref={activeHref} routesData={routesData} routeCustomersData={routeCustomersData} /></>;
}
