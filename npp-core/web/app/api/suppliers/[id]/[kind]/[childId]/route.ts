import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeSupplierGatewayError,
  patchSupplierAddress,
  patchSupplierContact,
  patchSupplierPaymentTerm,
  resolveSupplierRequestId,
} from '../../../../../../lib/supplier-gateway';

export const dynamic = 'force-dynamic';

type SupplierChildKind = 'contacts' | 'addresses' | 'payment-terms';

function isSupplierChildKind(value: string): value is SupplierChildKind {
  return value === 'contacts' || value === 'addresses' || value === 'payment-terms';
}

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeSupplierGatewayError(error);
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; kind: string; childId: string } },
) {
  const requestId = resolveSupplierRequestId(request.headers.get('x-request-id'));
  if (!isSupplierChildKind(params.kind)) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Supplier resource not found', retryable: false }, requestId },
      { status: 404, headers: responseHeaders(requestId) },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Request body must be valid JSON', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  try {
    const data = params.kind === 'contacts'
      ? await patchSupplierContact<unknown>(params.id, params.childId, requestId, body)
      : params.kind === 'addresses'
        ? await patchSupplierAddress<unknown>(params.id, params.childId, requestId, body)
        : await patchSupplierPaymentTerm<unknown>(params.id, params.childId, requestId, body);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
