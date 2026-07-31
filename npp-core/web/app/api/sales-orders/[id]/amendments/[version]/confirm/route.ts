import { NextRequest } from 'next/server';
import { confirmSalesOrderAmendment } from '../../../../../../../lib/sales-order-gateway';
import type { SalesOrder } from '../../../../../../../lib/sales-order-types';
import {
  salesOrderErrorResponse,
  salesOrderIdempotencyKey,
  salesOrderRequestId,
  salesOrderResponse,
} from '../../../../_route-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; version: string } },
) {
  const requestId = salesOrderRequestId(request);
  try {
    return salesOrderResponse(
      await confirmSalesOrderAmendment<SalesOrder>(
        params.id,
        params.version,
        requestId,
        salesOrderIdempotencyKey(request),
      ),
      requestId,
    );
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
