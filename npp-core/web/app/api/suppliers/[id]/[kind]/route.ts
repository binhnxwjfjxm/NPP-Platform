import { NextRequest, NextResponse } from 'next/server';
import {
  createSupplierAddress,
  createSupplierContact,
  createSupplierPaymentTerm,
  listSupplierAddresses,
  listSupplierContacts,
  listSupplierPaymentTerms,
  normalizeSupplierGatewayError,
  resolveSupplierRequestId,
} from '../../../../../lib/supplier-gateway';

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

function invalidKindResponse(requestId: string) {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: 'Supplier resource not found', retryable: false }, requestId },
    { status: 404, headers: responseHeaders(requestId) },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; kind: string } },
) {
  const requestId = resolveSupplierRequestId(request.headers.get('x-request-id'));
  if (!isSupplierChildKind(params.kind)) return invalidKindResponse(requestId);

  try {
    const data = params.kind === 'contacts'
      ? await listSupplierContacts<unknown>(params.id, requestId)
      : params.kind === 'addresses'
        ? await listSupplierAddresses<unknown>(params.id, requestId)
        : await listSupplierPaymentTerms<unknown>(params.id, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; kind: string } },
) {
  const requestId = resolveSupplierRequestId(request.headers.get('x-request-id'));
  if (!isSupplierChildKind(params.kind)) return invalidKindResponse(requestId);

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
    const idempotencyKey = request.headers.get('idempotency-key') ?? undefined;
    const data = params.kind === 'contacts'
      ? await createSupplierContact<unknown>(params.id, requestId, body, idempotencyKey)
      : params.kind === 'addresses'
        ? await createSupplierAddress<unknown>(params.id, requestId, body, idempotencyKey)
        : await createSupplierPaymentTerm<unknown>(params.id, requestId, body, idempotencyKey);
    return NextResponse.json({ data, requestId }, { status: 201, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
