import { proxyBackendRequest } from "@/lib/api/backend-proxy";

type RouteContext = {
  params: { path?: string[] };
};

function backendPath(context: RouteContext) {
  const segments = Array.isArray(context.params.path) ? context.params.path : [];
  return `/api/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export const dynamic = "force-dynamic";

export function GET(request: Request, context: RouteContext) {
  return proxyBackendRequest(request, backendPath(context), "GET");
}

export function POST(request: Request, context: RouteContext) {
  return proxyBackendRequest(request, backendPath(context), "POST");
}

export function PATCH(request: Request, context: RouteContext) {
  return proxyBackendRequest(request, backendPath(context), "PATCH");
}

export function DELETE(request: Request, context: RouteContext) {
  return proxyBackendRequest(request, backendPath(context), "DELETE");
}
