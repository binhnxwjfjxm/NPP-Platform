import { NextRequest } from 'next/server';
import { getSalesOrder } from '../../../../lib/sales-order-gateway';
import type { SalesOrder } from '../../../../lib/sales-order-types';
import {
  salesOrderErrorResponse,
  salesOrderRequestId,
  salesOrderResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = salesOrderRequestId(request);
  try {
    return salesOrderResponse(
      await getSalesOrder<SalesOrder>(params.id, requestId),
      requestId,
    );
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
