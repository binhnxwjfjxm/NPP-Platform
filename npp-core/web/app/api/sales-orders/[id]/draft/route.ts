import { NextRequest } from 'next/server';
import { updateSalesOrderDraft } from '../../../../../lib/sales-order-gateway';
import type { SalesOrder } from '../../../../../lib/sales-order-types';
import {
  readSalesOrderBody,
  salesOrderErrorResponse,
  salesOrderRequestId,
  salesOrderResponse,
} from '../../_route-helpers';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = salesOrderRequestId(request);
  const parsed = await readSalesOrderBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    return salesOrderResponse(
      await updateSalesOrderDraft<SalesOrder>(params.id, requestId, parsed.body),
      requestId,
    );
  } catch (error) {
    return salesOrderErrorResponse(error, requestId);
  }
}
