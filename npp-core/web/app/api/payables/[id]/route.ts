import { NextRequest } from 'next/server';
import { getPayable } from '../../../../lib/payable-gateway';
import { payableErrorResponse, payableRequestId, payableResponse } from '../_route-helpers';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id:string }> | { id:string } };
export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = payableRequestId(request);
  try { const params = await context.params; return payableResponse(await getPayable<unknown>(params.id,requestId),requestId); }
  catch (error) { return payableErrorResponse(error,requestId); }
}
