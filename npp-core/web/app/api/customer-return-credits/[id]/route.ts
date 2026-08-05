import { NextRequest } from 'next/server';
import { getCustomerReturnCredit } from '../../../../lib/customer-return-credit-gateway';
import {
  customerReturnCreditErrorResponse,
  customerReturnCreditRequestId,
  customerReturnCreditResponse,
} from '../_route-helpers';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = customerReturnCreditRequestId(request);
  try {
    const { id } = await params;
    const data = await getCustomerReturnCredit<unknown>(id, requestId);
    return customerReturnCreditResponse(data, requestId);
  } catch (error) {
    return customerReturnCreditErrorResponse(error, requestId);
  }
}
