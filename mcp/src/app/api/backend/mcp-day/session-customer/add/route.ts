import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function POST(request: Request) {
  const response = await proxyBackendRequest(
    request,
    "/api/mcp-day/session-customer/add",
    "POST"
  );

  if (!response.ok) return response;

  const payload = object(await response.json().catch(() => ({})));
  const data = object(payload.data);
  const routeCustomerId = String(data.routeCustomerId || "").trim();
  const sessionCustomerId = String(data.sessionCustomerId || "").trim();

  if (routeCustomerId && !Object.keys(object(data.routeCustomer)).length) {
    data.routeCustomer = { id: routeCustomerId };
  }
  if (sessionCustomerId && !Object.keys(object(data.sessionCustomer)).length) {
    data.sessionCustomer = { id: sessionCustomerId };
  }

  return Response.json(
    { ...payload, data },
    {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": response.headers.get("x-request-id") || ""
      }
    }
  );
}
