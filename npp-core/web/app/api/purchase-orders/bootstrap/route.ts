import { NextRequest, NextResponse } from 'next/server';
import { loadPurchaseOrderBootstrap } from '../../../../lib/purchase-order-bootstrap';
import { resolvePurchaseOrderRequestId } from '../../../../lib/purchase-order-gateway';

export const dynamic = 'force-dynamic';

function responseHeaders(requestId: string) {
  return { 'Cache-Control': 'no-store', 'x-request-id': requestId };
}

export async function GET(request: NextRequest) {
  const requestId = resolvePurchaseOrderRequestId(request.headers.get('x-request-id'));
  try {
    const data = await loadPurchaseOrderBootstrap(requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: 'PURCHASE_ORDER_BOOTSTRAP_UNAVAILABLE',
          message: 'Không tải được dữ liệu đơn đặt hàng',
          retryable: true,
        },
        requestId,
      },
      { status: 503, headers: responseHeaders(requestId) },
    );
  }
}
