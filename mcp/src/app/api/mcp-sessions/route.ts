import { errorResponse } from "@/lib/export/supabase-rest";
import { loadMcpSessions } from "@/lib/mcp-sessions/load-mcp-sessions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const data = await loadMcpSessions({
      dateFrom: String(url.searchParams.get("dateFrom") || ""),
      dateTo: String(url.searchParams.get("dateTo") || ""),
      routeId: String(url.searchParams.get("routeId") || ""),
      status: String(url.searchParams.get("status") || "")
    });

    return Response.json(
      { data, receivedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
