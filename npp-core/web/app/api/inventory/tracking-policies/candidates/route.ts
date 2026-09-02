import { NextRequest, NextResponse } from 'next/server';
import {
  listInventoryTrackingPolicyCandidatePage,
  listInventoryTrackingPolicyCandidates,
} from '../../../../../lib/inventory-policy-candidates';
import { errorResponse, requestIdFrom, responseHeaders } from '../../_shared';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request);
  try {
    const data = request.nextUrl.searchParams.has('offset')
      ? await listInventoryTrackingPolicyCandidatePage(requestId, request.nextUrl.searchParams)
      : await listInventoryTrackingPolicyCandidates(requestId, request.nextUrl.searchParams);
    return NextResponse.json({ data, requestId }, { status: 200, headers: responseHeaders(requestId) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
