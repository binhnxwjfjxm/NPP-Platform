import { NextRequest } from 'next/server';
import { createPayableAllocation } from '../../../lib/supplier-payment-gateway';
import {
  readSupplierPaymentBody,
  supplierPaymentErrorResponse,
  supplierPaymentIdempotencyKey,
  supplierPaymentRequestId,
  supplierPaymentResponse,
} from '../supplier-payments/_route-helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = supplierPaymentRequestId(request);
  const parsed = await readSupplierPaymentBody(request,requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await createPayableAllocation<unknown>(
      requestId,
      parsed.body,
      supplierPaymentIdempotencyKey(request),
    );
    return supplierPaymentResponse(data,requestId,201);
  } catch (error) {
    return supplierPaymentErrorResponse(error,requestId);
  }
}
