import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  return proxyBackendRequest(
    request,
    `/api/routes/${encodeURIComponent(params.id)}`,
    "PATCH"
  );
}
