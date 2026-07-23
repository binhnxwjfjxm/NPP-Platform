import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return proxyBackendRequest(request, "/api/mcp-report-settings", "GET");
}

export async function POST(request: Request) {
  return proxyBackendRequest(request, "/api/mcp-report-settings", "POST");
}

export async function PATCH(request: Request) {
  return proxyBackendRequest(request, "/api/mcp-report-settings", "PATCH");
}
