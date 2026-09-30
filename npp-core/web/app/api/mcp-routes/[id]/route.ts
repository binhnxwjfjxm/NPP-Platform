import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeMcpRouteSettingsGatewayError,
  patchMcpRoute,
  resolveMcpRouteSettingsRequestId,
} from '../../../../lib/mcp-route-settings-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = resolveMcpRouteSettingsRequestId(request.headers.get('x-request-id'));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu tuyến không hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  try {
    const data = await patchMcpRoute<unknown>(
      params.id,
      requestId,
      body,
      request.headers.get('idempotency-key') ?? undefined,
    );
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    const normalized = normalizeMcpRouteSettingsGatewayError(error);
    return NextResponse.json(
      { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
      { status: normalized.statusCode, headers: responseHeaders(requestId) },
    );
  }
}
