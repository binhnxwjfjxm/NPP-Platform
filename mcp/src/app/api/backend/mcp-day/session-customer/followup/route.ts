import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return proxyBackendRequest(
    request,
    "/api/mcp-day/session-customer/followup",
    "POST"
  );
}
