import { NextRequest, NextResponse } from 'next/server';
import {
  isFoundationR2TestEnabled,
  isFoundationUiEnabled,
  normalizeFoundationGatewayError,
  resolveFoundationRequestId,
  runFoundationR2Test,
} from '../../../../lib/foundation-gateway';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isFoundationUiEnabled() || !isFoundationR2TestEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const requestId = resolveFoundationRequestId(request.headers.get('x-request-id'));
  try {
    const result = await runFoundationR2Test(requestId);
    return NextResponse.json(result, {
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
