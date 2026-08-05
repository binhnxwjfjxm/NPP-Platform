import { NextRequest } from 'next/server';
import { allocateCustomerPayment } from '../../../../../lib/customer-payment-gateway';
import {
  customerPaymentErrorResponse,
  customerPaymentIdempotencyKey,
  customerPaymentRequestId,
  customerPaymentResponse,
  readCustomerPaymentBody,
} from '../../_route-helpers';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = customerPaymentRequestId(request);
  const parsed = await readCustomerPaymentBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const { id } = await context.params;
    return customerPaymentResponse(
      await allocateCustomerPayment(
        id,
        requestId,
        parsed.body,
        customerPaymentIdempotencyKey(request),
      ),
      requestId,
    );
  } catch (error) {
    return customerPaymentErrorResponse(error, requestId);
  }
}
