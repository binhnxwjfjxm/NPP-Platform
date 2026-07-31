import { NextRequest } from 'next/server';
import { searchSalesOrderSkus } from '../../../../lib/sales-order-gateway';
import type { SalesOrderSkuSearchOption } from '../../../../lib/sales-order-types';
import {
  salesOrderErrorResponse,
  salesOrderRequestId,
  salesOrderResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = salesOrderRequestId(request);
  try {
    const data = await searchSalesOrderSkus<SalesOrderSkuSearchOption>(
      requestId,
      request.nextUrl.searchParams,
    );
    return salesOrderResponse(data, requestId);
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
