import { NextRequest } from 'next/server';
import {
  getPurchaseOrder,
  patchPurchaseOrderDraft,
} from '../../../../lib/purchase-order-gateway';
import {
  purchaseOrderErrorResponse,
  purchaseOrderIdempotencyKey,
  purchaseOrderRequestId,
  purchaseOrderResponse,
  readPurchaseOrderBody,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = purchaseOrderRequestId(request);
  try {
    return purchaseOrderResponse(
      await getPurchaseOrder<unknown>(params.id, requestId),
      requestId,
    );
  } catch (error) {
    return purchaseOrderErrorResponse(error, requestId);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = purchaseOrderRequestId(request);
  const parsed = await readPurchaseOrderBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    return purchaseOrderResponse(
      await patchPurchaseOrderDraft<unknown>(
        params.id,
        requestId,
        parsed.body,
        purchaseOrderIdempotencyKey(request),
      ),
      requestId,
    );
  } catch (error) {
    return purchaseOrderErrorResponse(error, requestId);
  }
}
