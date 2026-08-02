import { reportErrorMessage } from "@/lib/export/business-report";
import { backendReadCount, backendReadRows } from "@/lib/api/backend-read";

type QueryValue = string | number | boolean | null | undefined;

type RequestOptions = {
  select?: string;
  order?: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, QueryValue>;
};

export async function restRows<T>(table: string, options: RequestOptions = {}) {
  return backendReadRows<T>(table, options);
}

export async function restCount(table: string, options: Omit<RequestOptions, "select" | "order" | "limit" | "offset"> = {}) {
  return backendReadCount(table, options);
}

export function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "export_failed";
  return Response.json({
    ok: false,
    error: reportErrorMessage(code),
    code
  }, { status: 400, headers: { "Cache-Control": "no-store" } });
}
