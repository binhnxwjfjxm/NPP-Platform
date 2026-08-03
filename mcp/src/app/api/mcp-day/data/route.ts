import { loadMcpDayData } from "@/lib/api/mcp-day-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const routeId = String(url.searchParams.get("routeId") || url.searchParams.get("route_id") || "").trim();
  const date = String(
    url.searchParams.get("date") ||
    url.searchParams.get("sessionDate") ||
    url.searchParams.get("session_date") ||
    ""
  ).slice(0, 10);

  if (!routeId) {
    return Response.json(
      { error: { code: "ROUTE_ID_REQUIRED", message: "Cần chọn tuyến để mở lượt ghé" } },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const data = await loadMcpDayData({ routeId, date, request });
    return Response.json(
      { data, receivedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "mcp_day_read_failed";
    return Response.json(
      { error: { code, message: "Không tải được dữ liệu lượt ghé" } },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
