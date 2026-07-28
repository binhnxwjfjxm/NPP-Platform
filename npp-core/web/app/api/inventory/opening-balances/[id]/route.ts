import { NextRequest, NextResponse } from 'next/server';
import { getOpeningBalanceImport } from '../../../../../lib/inventory-gateway';
import { errorResponse, requestIdFrom, responseHeaders } from '../../_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = requestIdFrom(request);
  const { id } = await context.params;
  try {
    const data = await getOpeningBalanceImport<unknown>(id, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
