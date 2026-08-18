import { NextRequest, NextResponse } from 'next/server';
import {
  getInventoryHoldBreakdown,
  normalizeInventoryHoldGatewayError,
  resolveInventoryHoldRequestId,
} from '../../../../lib/inventory-hold-gateway';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = resolveInventoryHoldRequestId(request.headers.get('x-request-id'));
  try {
    const data = await getInventoryHoldBreakdown({
      warehouseId: request.nextUrl.searchParams.get('warehouseId') ?? '',
      baseVariantId: request.nextUrl.searchParams.get('baseVariantId') ?? '',
      excludeSalesOrderId: request.nextUrl.searchParams.get('excludeSalesOrderId'),
      requestId,
    });
    return NextResponse.json(
      { data, requestId },
      { status: 200, headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId } },
    );
  } catch (error) {
    const normalized = normalizeInventoryHoldGatewayError(error);
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
      {
        status: normalized.statusCode,
        headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId },
      },
    );
  }
}
