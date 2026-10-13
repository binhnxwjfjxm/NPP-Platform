import { NextRequest } from 'next/server';
import { getManualSalesOrderReturn, receiveManualSalesOrderReturn } from '../../../../../lib/sales-order-gateway';
import type { SalesOrder } from '../../../../../lib/sales-order-types';
import {
  readSalesOrderBody, salesOrderErrorResponse, salesOrderIdempotencyKey,
  salesOrderRequestId, salesOrderResponse,
} from '../../_route-helpers';

type Params = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Params) {
  const requestId = salesOrderRequestId(request);
  try {
    return salesOrderResponse(
      await getManualSalesOrderReturn<unknown>(params.id, requestId), requestId,
    );
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const requestId = salesOrderRequestId(request);
  const parsed = await readSalesOrderBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    return salesOrderResponse(
      await receiveManualSalesOrderReturn<SalesOrder>(
        params.id, requestId, parsed.body, salesOrderIdempotencyKey(request),
      ),
      requestId,
    );
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
