import { NextRequest } from 'next/server';
import { reverseCustomerRefund } from '../../../../../lib/customer-return-credit-gateway';
import {
  customerReturnCreditErrorResponse,
  customerReturnCreditIdempotencyKey,
  customerReturnCreditRequestId,
  customerReturnCreditResponse,
  readCustomerReturnCreditBody,
} from '../../../customer-return-credits/_route-helpers';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = customerReturnCreditRequestId(request);
  const input = await readCustomerReturnCreditBody(request, requestId);
  if (!input.ok) return input.response;
  try {
    const { id } = await params;
    const data = await reverseCustomerRefund<unknown>(
      id,
      requestId,
      input.body,
      customerReturnCreditIdempotencyKey(request),
    );
    return customerReturnCreditResponse(data, requestId);
  } catch (error) {
    return customerReturnCreditErrorResponse(error, requestId);
  }
}
