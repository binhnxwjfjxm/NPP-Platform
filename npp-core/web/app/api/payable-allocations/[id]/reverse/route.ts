import { NextRequest } from 'next/server';
import { reversePayableAllocation } from '../../../../../lib/supplier-payment-gateway';
import {
  readSupplierPaymentBody,
  supplierPaymentErrorResponse,
  supplierPaymentIdempotencyKey,
  supplierPaymentRequestId,
  supplierPaymentResponse,
} from '../../../supplier-payments/_route-helpers';

export const dynamic = 'force-dynamic';
type RouteContext = { params: { id: string } };

export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = supplierPaymentRequestId(request);
  const parsed = await readSupplierPaymentBody(request,requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await reversePayableAllocation<unknown>(
      context.params.id,
      requestId,
      parsed.body,
      supplierPaymentIdempotencyKey(request),
    );
    return supplierPaymentResponse(data,requestId);
  } catch (error) {
    return supplierPaymentErrorResponse(error,requestId);
  }
}
