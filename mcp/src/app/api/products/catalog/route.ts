import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  url.searchParams.set("catalog", "all");
  url.searchParams.set("includePrice", "false");
  url.searchParams.delete("prices");
  url.searchParams.delete("q");
  url.searchParams.delete("search");
  url.searchParams.delete("category");
  url.searchParams.delete("brand");
  return proxyBackendRequest(new Request(url, request), "/api/core-sales/products/search", "GET");
}
