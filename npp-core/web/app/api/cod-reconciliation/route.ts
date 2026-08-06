import { NextRequest } from 'next/server';
import { listCodHandovers } from '../../../lib/cod-reconciliation-gateway';
import { codErrorResponse, codRequestId, codResponse } from './_route-helpers';

export async function GET(request: NextRequest) {
  const requestId = codRequestId(request);
  try {
    const data = await listCodHandovers<unknown>(requestId, Object.fromEntries(request.nextUrl.searchParams));
    return codResponse(data, requestId);
  } catch (error) { return codErrorResponse(error, requestId); }
}
