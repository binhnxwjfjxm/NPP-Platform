import { NextRequest } from 'next/server';
import {
  createPurchaseOrderDraft,
  listPurchaseOrders,
} from '../../../lib/purchase-order-gateway';
import {
  purchaseOrderErrorResponse,
  purchaseOrderIdempotencyKey,
  purchaseOrderRequestId,
  purchaseOrderResponse,
  readPurchaseOrderBody,
} from './_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = purchaseOrderRequestId(request);
  try {
    const data = await listPurchaseOrders<unknown>(requestId, {
      limit: request.nextUrl.searchParams.has('limit') ? Number(request.nextUrl.searchParams.get('limit')) : undefined,
      offset: request.nextUrl.searchParams.has('offset') ? Number(request.nextUrl.searchParams.get('offset')) : undefined,
      status: (request.nextUrl.searchParams.get('status') || undefined) as never,
      supplierId: request.nextUrl.searchParams.get('supplierId') || undefined,
      warehouseId: request.nextUrl.searchParams.get('warehouseId') || undefined,
      search: request.nextUrl.searchParams.get('search') || undefined,
    });
    return purchaseOrderResponse(data, requestId);
  } catch (error) {
    return purchaseOrderErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = purchaseOrderRequestId(request);
  const parsed = await readPurchaseOrderBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await createPurchaseOrderDraft(
      requestId,
      parsed.body,
      purchaseOrderIdempotencyKey(request),
    );
    return purchaseOrderResponse(data, requestId, 201);
  } catch (error) {
    return purchaseOrderErrorResponse(error, requestId);
  }
}
