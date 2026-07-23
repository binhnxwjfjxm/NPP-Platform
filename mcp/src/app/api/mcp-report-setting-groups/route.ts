import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return proxyBackendRequest(request, "/api/mcp-report-setting-groups", "POST");
}

export function PATCH(request: Request) {
  return proxyBackendRequest(request, "/api/mcp-report-setting-groups", "PATCH");
}
