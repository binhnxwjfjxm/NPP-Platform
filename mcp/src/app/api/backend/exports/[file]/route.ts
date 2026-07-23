export const dynamic = "force-dynamic";

const LOCAL_EXPORTS = new Set([
  "route-customers.csv",
  "mcp-sessions.csv",
  "orders.csv",
  "market-reports.csv",
  "followups.csv",
  "tests.csv",
  "route-customers-needs-gps.csv"
]);

async function localExport(file: string, request: Request) {
  if (file === "route-customers.csv") {
    const route = await import("@/app/api/exports/route-customers.csv/route");
    return route.GET(request);
  }
  if (file === "mcp-sessions.csv") {
    const route = await import("@/app/api/exports/mcp-sessions.csv/route");
    return route.GET(request);
  }
  if (file === "orders.csv") {
    const route = await import("@/app/api/exports/orders.csv/route");
    return route.GET(request);
  }
  if (file === "market-reports.csv") {
    const route = await import("@/app/api/exports/market-reports.csv/route");
    return route.GET(request);
  }
  if (file === "followups.csv") {
    const route = await import("@/app/api/exports/followups.csv/route");
    return route.GET(request);
  }
  if (file === "tests.csv") {
    const route = await import("@/app/api/exports/tests.csv/route");
    return route.GET(request);
  }
  if (file === "route-customers-needs-gps.csv") {
    const route = await import("@/app/api/exports/route-customers-needs-gps.csv/route");
    return route.GET(request);
  }
  return Response.json({ ok: false, error: "export_not_allowed" }, { status: 404 });
}

export async function GET(request: Request, context: { params: { file: string } }) {
  const file = context.params.file;
  if (!LOCAL_EXPORTS.has(file)) return Response.json({ ok: false, error: "export_not_allowed" }, { status: 404 });
  return localExport(file, request);
}
