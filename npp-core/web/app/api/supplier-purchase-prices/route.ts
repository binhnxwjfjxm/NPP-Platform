import { NextRequest } from 'next/server';
import {
  createSupplierPurchasePrice,
  listSupplierPurchasePrices,
} from '../../../lib/supplier-purchase-price-gateway';
import {
  purchasePriceErrorResponse,
  purchasePriceRequestId,
  purchasePriceResponse,
  readPurchasePriceBody,
} from './_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = purchasePriceRequestId(request);
  try {
    const data = await listSupplierPurchasePrices<unknown>(requestId, request.nextUrl.searchParams);
    return purchasePriceResponse(data, requestId);
  } catch (error) {
    return purchasePriceErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = purchasePriceRequestId(request);
  const parsed = await readPurchasePriceBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await createSupplierPurchasePrice<unknown>(
      requestId,
      parsed.body,
      request.headers.get('idempotency-key') ?? '',
    );
    return purchasePriceResponse(data, requestId, 201);
  } catch (error) {
    return purchasePriceErrorResponse(error, requestId);
  }
}
