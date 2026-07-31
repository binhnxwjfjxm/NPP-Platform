import { NextRequest } from 'next/server';
import { updateSupplierPurchasePrice } from '../../../../lib/supplier-purchase-price-gateway';
import {
  purchasePriceErrorResponse,
  purchasePriceRequestId,
  purchasePriceResponse,
  readPurchasePriceBody,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const requestId = purchasePriceRequestId(request);
  const parsed = await readPurchasePriceBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const { id } = await context.params;
    const data = await updateSupplierPurchasePrice<unknown>(id, requestId, parsed.body);
    return purchasePriceResponse(data, requestId);
  } catch (error) {
    return purchasePriceErrorResponse(error, requestId);
  }
}
