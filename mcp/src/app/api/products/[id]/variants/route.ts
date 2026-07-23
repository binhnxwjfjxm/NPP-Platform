import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const productId = String(params.id || "").trim();
  if (!productId) {
    return Response.json(
      { ok: false, error: "product_id_required" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  return proxyBackendRequest(
    request,
    `/api/products/${encodeURIComponent(productId)}/variants`,
    "GET"
  );
}
