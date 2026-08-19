import { NextRequest } from 'next/server';
import { listCustomerPaymentRemittingEmployees } from '../../../../lib/customer-payment-gateway';
import {
  customerPaymentErrorResponse,
  customerPaymentRequestId,
  customerPaymentResponse,
} from '../_route-helpers';

export async function GET(request: NextRequest) {
  const requestId = customerPaymentRequestId(request);
  try {
    return customerPaymentResponse(
      await listCustomerPaymentRemittingEmployees(requestId),
      requestId,
    );
  } catch (error) {
    return customerPaymentErrorResponse(error, requestId);
  }
}
