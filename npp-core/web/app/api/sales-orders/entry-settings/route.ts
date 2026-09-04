import { NextRequest } from 'next/server';
import type { SalesOrderEntrySettings } from '../../../../lib/sales-order-types';
import {
  getSalesOrderEntrySettings,
  updateSalesOrderEntrySettings,
} from '../../../../lib/sales-order-gateway';
import {
  readSalesOrderBody,
  salesOrderErrorResponse,
  salesOrderIdempotencyKey,
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

export async function PUT(request: NextRequest) {
  const requestId = salesOrderRequestId(request);
  const parsed = await readSalesOrderBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await updateSalesOrderEntrySettings<SalesOrderEntrySettings>(
      requestId,
      parsed.body,
      salesOrderIdempotencyKey(request),
    );
    return salesOrderResponse(data, requestId);
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
