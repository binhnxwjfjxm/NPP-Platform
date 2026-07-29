import { NextRequest } from 'next/server';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  submitPurchaseOrder,
} from '../../../../lib/purchase-order-gateway';
import {
  purchaseOrderErrorResponse,
  purchaseOrderIdempotencyKey,
  purchaseOrderRequestId,
  purchaseOrderResponse,
  readPurchaseOrderBody,
} from '../_route-helpers';

export async function proxyPurchaseOrderAction(
  request: NextRequest,
  id: string,
  action: 'submit' | 'approve' | 'cancel',
) {
  const requestId = purchaseOrderRequestId(request);
  const parsed = await readPurchaseOrderBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const key = purchaseOrderIdempotencyKey(request);
    const data = action === 'submit'
      ? await submitPurchaseOrder<unknown>(id, requestId, key, parsed.body)
      : action === 'approve'
        ? await approvePurchaseOrder<unknown>(id, requestId, key, parsed.body)
        : await cancelPurchaseOrder<unknown>(id, requestId, key, parsed.body);
    return purchaseOrderResponse(data, requestId);
  } catch (error) {
    return purchaseOrderErrorResponse(error, requestId);
  }
}
