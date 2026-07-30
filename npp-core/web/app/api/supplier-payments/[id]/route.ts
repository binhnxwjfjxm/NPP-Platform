import { NextRequest } from 'next/server';
import { getSupplierPayment } from '../../../../lib/supplier-payment-gateway';
import {
  supplierPaymentErrorResponse,
  supplierPaymentRequestId,
  supplierPaymentResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = supplierPaymentRequestId(request);
  try {
    const data = await getSupplierPayment<unknown>(context.params.id,requestId);
    return supplierPaymentResponse(data,requestId);
  } catch (error) {
    return supplierPaymentErrorResponse(error,requestId);
  }
}
