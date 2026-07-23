import { errorResponse } from "@/lib/export/supabase-rest";
import {
  buildSessionReportExportPayload,
  buildSessionReportMarkdownV2,
  sessionReportExportFilenameV2
} from "@/lib/mcp/session-report-export-v2";
import { loadMcpSessionReportSource } from "@/lib/mcp/session-report-source";

export const dynamic = "force-dynamic";

function value(input: unknown) {
  return String(input ?? "").trim();
}

function queryFrom(request: Request) {
  const query = new URL(request.url).searchParams;
  return {
    sessionId: value(query.get("sessionId") || query.get("session_id")),
    routeId: value(query.get("routeId") || query.get("route_id")),
    date: value(query.get("date") || query.get("sessionDate") || query.get("session_date")).slice(0, 10),
    format: value(query.get("format") || "json").toLowerCase()
  };
}

function downloadHeaders(filename: string, contentType: string) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename=${filename}`
  };
}

export async function GET(request: Request) {
  try {
    const query = queryFrom(request);
    const supported = ["json", "markdown", "md"];
    if (!supported.includes(query.format)) throw new Error("unsupported_session_report_export_format");

    const source = await loadMcpSessionReportSource(query);
    const payload = buildSessionReportExportPayload(source);

    if (query.format === "markdown" || query.format === "md") {
      const filename = sessionReportExportFilenameV2(payload, "md");
      return new Response(buildSessionReportMarkdownV2(payload), {
        headers: downloadHeaders(filename, "text/markdown; charset=utf-8")
      });
    }

    const filename = sessionReportExportFilenameV2(payload, "json");
    return new Response(JSON.stringify(payload, null, 2), {
      headers: downloadHeaders(filename, "application/json; charset=utf-8")
    });
  } catch (error) {
    return errorResponse(error);
  }
}
