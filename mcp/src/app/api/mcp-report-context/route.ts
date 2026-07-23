import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyBackendRequest(request, "/api/mcp-report-context", "GET");
}
