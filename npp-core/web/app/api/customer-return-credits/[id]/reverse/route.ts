import { NextRequest } from 'next/server';
import { reverseCustomerReturnCredit } from '../../../../../lib/customer-return-credit-gateway';
import {
  customerReturnCreditErrorResponse,
  customerReturnCreditIdempotencyKey,
  customerReturnCreditRequestId,
  customerReturnCreditResponse,
  readCustomerReturnCreditBody,
} from '../../_route-helpers';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = customerReturnCreditRequestId(request);
  const input = await readCustomerReturnCreditBody(request, requestId);
  if (!input.ok) return input.response;
  try {
    const { id } = await params;
    const data = await reverseCustomerReturnCredit<unknown>(
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
