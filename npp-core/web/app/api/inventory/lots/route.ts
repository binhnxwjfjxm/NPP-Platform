import { NextRequest, NextResponse } from 'next/server';
import { listInventoryLots } from '../../../../lib/inventory-gateway';
import { listAllInventoryLots } from '../../../../lib/inventory-list-loaders';
import { errorResponse, requestIdFrom, responseHeaders } from '../_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request);
  try {
    const data = request.nextUrl.searchParams.has('offset')
      ? await listInventoryLots<unknown[]>(requestId, request.nextUrl.searchParams)
      : await listAllInventoryLots(requestId, request.nextUrl.searchParams);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
