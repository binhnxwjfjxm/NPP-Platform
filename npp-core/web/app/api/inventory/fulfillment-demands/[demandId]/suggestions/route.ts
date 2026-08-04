import { NextRequest, NextResponse } from 'next/server';
import { getFulfillmentSuggestions } from '../../../../../../lib/inventory-gateway';
import { errorResponse, requestIdFrom, responseHeaders } from '../../../_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ demandId: string }> }) {
  const { demandId } = await context.params;
  const requestId = requestIdFrom(request);
  try {
    const data = await getFulfillmentSuggestions<unknown>(demandId, requestId);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
