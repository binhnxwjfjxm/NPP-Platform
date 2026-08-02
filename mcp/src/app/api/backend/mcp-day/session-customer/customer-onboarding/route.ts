import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return proxyBackendRequest(
    request,
    `/api/mcp-day/session-customer/customer-onboarding${url.search}`,
    "GET"
  );
}
