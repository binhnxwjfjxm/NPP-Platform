import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const search = String(url.searchParams.get("q") || url.searchParams.get("search") || "").trim();
  if (!search) {
    return Response.json({ data: [], receivedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  }
  url.searchParams.delete("catalog");
  url.searchParams.set("limit", "30");
  url.searchParams.set("includePrice", "false");
  return proxyBackendRequest(new Request(url, request), "/api/core-sales/products/search", "GET");
}
