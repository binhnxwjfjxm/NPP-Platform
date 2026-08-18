import { NextResponse } from 'next/server';
import { normalizeInventoryGatewayError, resolveInventoryRequestId } from '../../../lib/inventory-gateway';

type GatewayErrorNormalizer = (error: unknown) => {
  code: string;
  publicMessage: string;
  statusCode: number;
  retryable: boolean;
  details: unknown;
};

export const responseHeaders = (requestId: string) => ({ 'Cache-Control': 'no-store', 'x-request-id': requestId });

export function errorResponse(
  error: unknown,
  requestId: string,
  normalizeError: GatewayErrorNormalizer = normalizeInventoryGatewayError,
) {
  const normalized = normalizeError(error);
  return NextResponse.json(
    {
      error: {
        code: normalized.code,
        message: normalized.publicMessage,
        retryable: normalized.retryable,
        details: normalized.details,
      },
      requestId,
    },
    { status: normalized.statusCode, headers: responseHeaders(requestId) },
  );
}

export async function readJsonBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function requestIdFrom(request: Request): string {
  return resolveInventoryRequestId(request.headers.get('x-request-id'));
}
