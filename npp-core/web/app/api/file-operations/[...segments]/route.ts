import { NextRequest, NextResponse } from 'next/server';
import { FileOperationGatewayError, requestFileOperation } from '../../../../lib/file-operation-gateway';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { segments: string[] } };
function pathFrom(context: RouteContext) { return context.params.segments.join('/'); }
function errorResponse(error: unknown) {
  const normalized = error instanceof FileOperationGatewayError ? error : new FileOperationGatewayError('FILE_OPERATION_GATEWAY_UNAVAILABLE', 'Cổng import/export tạm thời không khả dụng', 503, true);
  return NextResponse.json({ error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details } }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function sanitizeStocktakeExport(path: string, data: unknown) {
  if (path !== 'stocktake/export' || !data || typeof data !== 'object') return data;
  const value = data as { columns?: unknown; rows?: unknown; [key: string]: unknown };
  const columns = Array.isArray(value.columns) ? value.columns.filter((column) => column !== 'systemQuantity') : value.columns;
  const rows = Array.isArray(value.rows) ? value.rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const { systemQuantity: _hidden, ...safe } = row as Record<string, unknown>;
    return safe;
  }) : value.rows;
  return { ...value, columns, rows };
}
export async function GET(request: NextRequest, context: RouteContext) {
  try { const path = pathFrom(context); const data = await requestFileOperation({ path, method: 'GET', searchParams: request.nextUrl.searchParams, requestId: request.headers.get('x-request-id') }); return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const path = pathFrom(context); const body = await request.json();
    const data = await requestFileOperation({ path, method: 'POST', body, idempotencyKey: request.headers.get('idempotency-key'), requestId: request.headers.get('x-request-id') });
    return NextResponse.json({ data: sanitizeStocktakeExport(path, data) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
