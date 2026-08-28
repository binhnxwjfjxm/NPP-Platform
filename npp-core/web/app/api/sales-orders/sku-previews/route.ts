import { NextRequest } from 'next/server';
import { searchSalesOrderSkuPreviews } from '../../../../lib/sales-order-preview-gateway';
import {
  salesOrderErrorResponse,
  salesOrderRequestId,
  salesOrderResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = salesOrderRequestId(request);
  try {
    const data = await searchSalesOrderSkuPreviews(requestId, request.nextUrl.searchParams);
    return salesOrderResponse(data, requestId);
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
