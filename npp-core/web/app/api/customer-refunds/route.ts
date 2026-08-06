import { NextRequest } from 'next/server';
import { createCustomerRefund } from '../../../lib/customer-return-credit-gateway';
import type { CustomerRefundDraft } from '../../../lib/customer-return-credit-types';
import {
  customerReturnCreditErrorResponse,
  customerReturnCreditIdempotencyKey,
  customerReturnCreditRequestId,
  customerReturnCreditResponse,
  readCustomerReturnCreditBody,
} from '../customer-return-credits/_route-helpers';

export async function POST(request: NextRequest) {
  const requestId = customerReturnCreditRequestId(request);
  const input = await readCustomerReturnCreditBody(request, requestId);
  if (!input.ok) return input.response;
  try {
    const data = await createCustomerRefund<unknown>(
      requestId,
      input.body as CustomerRefundDraft,
      customerReturnCreditIdempotencyKey(request),
    );
    return customerReturnCreditResponse(data, requestId, 201);
  } catch (error) {
    return customerReturnCreditErrorResponse(error, requestId);
  }
}
