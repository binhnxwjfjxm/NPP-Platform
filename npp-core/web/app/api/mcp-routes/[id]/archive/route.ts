import { NextRequest, NextResponse } from 'next/server';
import {
  archiveMcpRoute,
  normalizeMcpRouteSettingsGatewayError,
  resolveMcpRouteSettingsRequestId,
} from '../../../../../lib/mcp-route-settings-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = resolveMcpRouteSettingsRequestId(request.headers.get('x-request-id'));
  try {
    const data = await archiveMcpRoute<unknown>(
      params.id,
      requestId,
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
