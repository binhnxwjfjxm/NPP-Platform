import { NextRequest } from 'next/server';
import type { CustomerPaymentDraft } from '../../../lib/customer-payment-types';
import {
  createCustomerPayment,
  listCustomerPayments,
} from '../../../lib/customer-payment-gateway';
import {
  customerPaymentErrorResponse,
  customerPaymentIdempotencyKey,
  customerPaymentRequestId,
  customerPaymentResponse,
  readCustomerPaymentBody,
} from './_route-helpers';

export async function GET(request: NextRequest) {
  const requestId = customerPaymentRequestId(request);
  try {
    const params: Record<string, string | number | undefined> = {};
    for (const key of [
      'limit',
      'offset',
      'status',
      'customerId',
      'warehouseId',
      'currencyCode',
      'search',
    ]) {
      const value = request.nextUrl.searchParams.get(key);
      if (value !== null) params[key] = value;
    }
    return customerPaymentResponse(
      await listCustomerPayments(requestId, params),
      requestId,
    );
  } catch (error) {
    return customerPaymentErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = customerPaymentRequestId(request);
  const parsed = await readCustomerPaymentBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    return customerPaymentResponse(
      await createCustomerPayment(
        requestId,
        parsed.body as CustomerPaymentDraft,
        customerPaymentIdempotencyKey(request),
      ),
      requestId,
      201,
    );
  } catch (error) {
    return customerPaymentErrorResponse(error, requestId);
  }
}
