import { NextRequest } from 'next/server';
import { getCustomerPayment } from '../../../../lib/customer-payment-gateway';
import {
  customerPaymentErrorResponse,
  customerPaymentRequestId,
  customerPaymentResponse,
} from '../_route-helpers';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = customerPaymentRequestId(request);
  try {
    const { id } = await context.params;
    return customerPaymentResponse(
      await getCustomerPayment(id, requestId),
      requestId,
    );
  } catch (error) {
    return customerPaymentErrorResponse(error, requestId);
  }
}
