import { NextRequest } from 'next/server';
import { resolveSupplierPurchasePrice } from '../../../../lib/supplier-purchase-price-gateway';
import {
  purchasePriceErrorResponse,
  purchasePriceRequestId,
  purchasePriceResponse,
  readPurchasePriceBody,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = purchasePriceRequestId(request);
  const parsed = await readPurchasePriceBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await resolveSupplierPurchasePrice<unknown>(requestId, parsed.body);
    return purchasePriceResponse(data, requestId);
  } catch (error) {
    return purchasePriceErrorResponse(error, requestId);
  }
}
