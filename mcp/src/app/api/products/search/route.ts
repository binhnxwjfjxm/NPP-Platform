import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  url.searchParams.set("catalog", "all");
  const fullCatalogRequest = new Request(url, request);
  return proxyBackendRequest(fullCatalogRequest, "/api/core-sales/products/search", "GET");
}
