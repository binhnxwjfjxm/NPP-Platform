import { NextRequest, NextResponse } from 'next/server';
import { listInventoryBalances } from '../../../../lib/inventory-gateway';
import { errorResponse, requestIdFrom, responseHeaders } from '../_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request);
  try {
    const data = await listInventoryBalances<unknown[]>(requestId, request.nextUrl.searchParams);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
