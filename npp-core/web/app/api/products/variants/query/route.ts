import { NextRequest, NextResponse } from 'next/server';
import {
  listProductVariantsForProducts,
  normalizeProductGatewayError,
  resolveProductRequestId,
} from '../../../../../lib/product-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

function errorResponse(error: unknown, requestId: string) {
  const normalized = normalizeProductGatewayError(error);
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

export async function POST(request: NextRequest) {
  const requestId = resolveProductRequestId(request.headers.get('x-request-id'));
  let body: { productIds?: unknown } | null;
  try {
    body = await request.json() as { productIds?: unknown };
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON_BODY', message: 'Dữ liệu gửi lên không hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }
  if (!Array.isArray(body?.productIds)) {
    return NextResponse.json(
      { error: { code: 'INVALID_PRODUCT_VARIANT_QUERY', message: 'Danh sách sản phẩm cần đọc SKU không hợp lệ', retryable: false }, requestId },
      { status: 400, headers: responseHeaders(requestId) },
    );
  }

  try {
    const productIds = body.productIds.map((value) => String(value ?? ''));
    const data = await listProductVariantsForProducts<unknown>(requestId, productIds);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
