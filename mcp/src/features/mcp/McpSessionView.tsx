"use client";

import { OrderQuantityStepperEnhancer } from "@/ui/shell/OrderQuantityStepperEnhancer";
import { MobileAppMenuProvider } from "@/ui/shell/MobileAppMenu";
import { RouteSessionWorkScreen } from "./RouteSessionWorkScreen";
import { McpCustomerProfileEnhancer } from "./McpCustomerProfileEnhancer";
import { McpRouteDirectionsProvider } from "./McpRouteDirectionsContext";
import { VisitsSessionReportPanel } from "./VisitsSessionReportPanel";
import type { McpDayData } from "@/features/mcp-day/mcp-day.types";
import type { RouteCustomersData } from "@/features/mcp/route-customers.types";
import type { RoutesData } from "@/features/routes/routes.types";

export function McpSessionView(props: {
  activeHref?: string;
  routesData: RoutesData;
  mcpDayData: McpDayData;
  routeCustomersData: RouteCustomersData;
}) {
  return (
    <MobileAppMenuProvider>
      <McpRouteDirectionsProvider routeCustomersData={props.routeCustomersData}>
        <OrderQuantityStepperEnhancer />
        <McpCustomerProfileEnhancer
          sessionId={props.mcpDayData.run.id}
          routeName={props.mcpDayData.run.routeName}
        />
        <VisitsSessionReportPanel mcpDayData={props.mcpDayData} />
        <RouteSessionWorkScreen {...props} />
      </McpRouteDirectionsProvider>
    </MobileAppMenuProvider>
  );
}
