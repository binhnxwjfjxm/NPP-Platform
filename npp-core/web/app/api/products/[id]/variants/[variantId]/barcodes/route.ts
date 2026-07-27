import { NextRequest, NextResponse } from 'next/server';
import { createVariantBarcode, listVariantBarcodes, normalizeProductGatewayError, resolveProductRequestId } from '../../../../../../../lib/product-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeProductGatewayError(error);
  return NextResponse.json(
    { error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable, details: normalized.details }, requestId },
    { status: normalized.statusCode, headers: responseHeaders(requestId) },
  );
}

async function readBody(request: NextRequest, requestId: string) {
  try { return { ok: true as const, body: await request.json() as unknown }; }
  catch {
    return { ok: false as const, response: NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Request body must be valid JSON', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    ) };
  }
}

type Params = { params: { id: string; variantId: string } };
export async function GET(request: NextRequest, { params }: Params) {
  const requestId = resolveProductRequestId(request.headers.get('x-request-id'));
  try {
    const data = await listVariantBarcodes<unknown>(params.id, params.variantId, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) { return errorResponse(error, requestId); }
}
export async function POST(request: NextRequest, { params }: Params) {
  const requestId = resolveProductRequestId(request.headers.get('x-request-id'));
  const parsed = await readBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await createVariantBarcode(params.id, params.variantId, requestId, parsed.body, request.headers.get('idempotency-key') ?? undefined);
    return NextResponse.json({ data, requestId }, { status: 201, headers: responseHeaders(requestId) });
  } catch (error) { return errorResponse(error, requestId); }
}
