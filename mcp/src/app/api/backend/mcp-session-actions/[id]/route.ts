import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

function sessionId(value: unknown) {
  return String(value ?? "").trim();
}

function invalidSessionResponse() {
  return Response.json(
    { ok: false, error: "session_id_required" },
    { status: 400, headers: { "Cache-Control": "no-store" } }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const id = sessionId(params.id);
  if (!id) return invalidSessionResponse();
  return proxyBackendRequest(
    request,
    `/api/mcp-sessions/${encodeURIComponent(id)}`,
    "PATCH"
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const id = sessionId(params.id);
  if (!id) return invalidSessionResponse();
  return proxyBackendRequest(
    request,
    `/api/mcp-sessions/${encodeURIComponent(id)}`,
    "DELETE"
  );
}
