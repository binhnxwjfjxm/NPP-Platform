import { NextRequest } from 'next/server';
import { cancelSalesOrder } from '../../../../../lib/sales-order-gateway';
import type { SalesOrder } from '../../../../../lib/sales-order-types';
import {
  readSalesOrderBody,
  salesOrderErrorResponse,
  salesOrderIdempotencyKey,
  salesOrderRequestId,
  salesOrderResponse,
} from '../../_route-helpers';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = salesOrderRequestId(request);
  const parsed = await readSalesOrderBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    return salesOrderResponse(
      await cancelSalesOrder<SalesOrder>(
        params.id,
        requestId,
        parsed.body,
        salesOrderIdempotencyKey(request),
      ),
      requestId,
    );
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
