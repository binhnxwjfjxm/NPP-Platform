import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return proxyBackendRequest(request, "/api/products/search", "GET");
}
