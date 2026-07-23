export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "order-slip",
  "session-day",
  "market-report",
  "dashboard",
  "test-result"
]);

function backendBaseUrl() {
  const value = String(process.env.BACKEND_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
  return value ? value.replace(/\/+$/, "") : null;
}

export async function GET(request: Request, context: { params: { report: string } }) {
  const report = context.params.report;
  if (!ALLOWED.has(report)) return Response.json({ ok: false, error: "pdf_report_not_allowed" }, { status: 404 });
  const baseUrl = backendBaseUrl();
  if (!baseUrl) return Response.json({ ok: false, error: "missing_backend_api_base_url" }, { status: 500 });

  try {
    const url = new URL(request.url);
    const response = await fetch(`${baseUrl}/api/pdf/${report}${url.search}`, { cache: "no-store", headers: { Accept: "text/html,*/*" } });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "pdf_proxy_failed" }, { status: 502 });
  }
}
