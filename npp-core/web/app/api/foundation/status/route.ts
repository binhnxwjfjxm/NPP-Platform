import { NextRequest, NextResponse } from 'next/server';
import {
  getFoundationStatus,
  isFoundationUiEnabled,
  normalizeFoundationGatewayError,
  resolveFoundationRequestId,
} from '../../../../lib/foundation-gateway';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isFoundationUiEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const requestId = resolveFoundationRequestId(request.headers.get('x-request-id'));
  try {
    const status = await getFoundationStatus(requestId);
    return NextResponse.json(status, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    const normalized = normalizeFoundationGatewayError(error);
    return NextResponse.json(
      {
        error: {
          code: normalized.code,
          message: normalized.publicMessage,
          retryable: normalized.retryable,
        },
        requestId,
        checkedAt: new Date().toISOString(),
      },
      {
        status: normalized.statusCode,
        headers: {
          'Cache-Control': 'no-store',
          'x-request-id': requestId,
        },
      },
    );
  }
}
