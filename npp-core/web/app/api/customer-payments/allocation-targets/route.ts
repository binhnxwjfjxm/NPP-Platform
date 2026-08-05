import { NextRequest } from 'next/server';
import { listCustomerPaymentTargets } from '../../../../lib/customer-payment-gateway';
import {
  customerPaymentErrorResponse,
  customerPaymentRequestId,
  customerPaymentResponse,
} from '../_route-helpers';

export async function GET(request: NextRequest) {
  const requestId = customerPaymentRequestId(request);
  try {
    const params: Record<string, string | number | undefined> = {};
    for (const key of ['customerId', 'warehouseId', 'currencyCode']) {
      const value = request.nextUrl.searchParams.get(key);
      if (value !== null) params[key] = value;
    }
    return customerPaymentResponse(
      await listCustomerPaymentTargets(requestId, params),
      requestId,
    );
  } catch (error) {
    return customerPaymentErrorResponse(error, requestId);
  }
}
