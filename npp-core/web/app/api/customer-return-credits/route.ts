import { NextRequest } from 'next/server';
import { listCustomerReturnCredits } from '../../../lib/customer-return-credit-gateway';
import {
  customerReturnCreditErrorResponse,
  customerReturnCreditRequestId,
  customerReturnCreditResponse,
} from './_route-helpers';

export async function GET(request: NextRequest) {
  const requestId = customerReturnCreditRequestId(request);
  try {
    const data = await listCustomerReturnCredits<unknown>(requestId, Object.fromEntries(request.nextUrl.searchParams));
    return customerReturnCreditResponse(data, requestId);
  } catch (error) {
    return customerReturnCreditErrorResponse(error, requestId);
  }
}
