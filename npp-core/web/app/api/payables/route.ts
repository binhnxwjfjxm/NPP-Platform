import { NextRequest } from 'next/server';
import { listPayables } from '../../../lib/payable-gateway';
import { payableErrorResponse, payableRequestId, payableResponse } from './_route-helpers';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const requestId = payableRequestId(request);
  try { return payableResponse(await listPayables<unknown>(requestId,Object.fromEntries(request.nextUrl.searchParams.entries())),requestId); }
  catch (error) { return payableErrorResponse(error,requestId); }
}
