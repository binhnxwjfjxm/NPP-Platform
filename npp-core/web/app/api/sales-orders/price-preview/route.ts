import { NextRequest } from 'next/server';
import { previewSalesOrderAppliedPrice } from '../../../../lib/sales-order-preview-gateway';
import {
  salesOrderErrorResponse,
  salesOrderRequestId,
  salesOrderResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = salesOrderRequestId(request);
  try {
    const input = await request.json() as Record<string, unknown>;
    const data = await previewSalesOrderAppliedPrice(requestId, input);
    return salesOrderResponse(data, requestId);
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
