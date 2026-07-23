import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const headers = new Headers(request.headers);
  if (!headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", `route.archive:${params.id}`);
  }
  return proxyBackendRequest(
    new Request(request, { headers }),
    `/api/routes/${encodeURIComponent(params.id)}/archive`,
    "POST"
  );
}
