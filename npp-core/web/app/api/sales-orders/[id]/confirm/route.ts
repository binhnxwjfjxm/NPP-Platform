import { NextRequest } from 'next/server';
import { confirmSalesOrder } from '../../../../../lib/sales-order-gateway';
import type { SalesOrder } from '../../../../../lib/sales-order-types';
import {
  salesOrderErrorResponse,
  salesOrderIdempotencyKey,
  salesOrderRequestId,
  salesOrderResponse,
} from '../../_route-helpers';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = salesOrderRequestId(request);
  try {
    return salesOrderResponse(
      await confirmSalesOrder<SalesOrder>(params.id, requestId, salesOrderIdempotencyKey(request)),
      requestId,
    );
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
