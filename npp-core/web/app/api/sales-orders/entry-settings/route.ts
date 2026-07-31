import { NextRequest } from 'next/server';
import type { SalesOrderEntrySettings } from '../../../../lib/sales-order-types';
import { getSalesOrderEntrySettings } from '../../../../lib/sales-order-gateway';
import {
  salesOrderErrorResponse,
  salesOrderRequestId,
  salesOrderResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = salesOrderRequestId(request);
  try {
    const data = await getSalesOrderEntrySettings<SalesOrderEntrySettings>(requestId);
    return salesOrderResponse(data, requestId);
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
