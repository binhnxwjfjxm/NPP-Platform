import type { NextRequest } from "next/server";

export function readParam(request: NextRequest, key: string): string | undefined {
  const value = request.nextUrl.searchParams.get(key);
  if (!value) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function readDateRange(request: NextRequest) {
  return {
    from: readParam(request, "from"),
    to: readParam(request, "to")
  };
}
