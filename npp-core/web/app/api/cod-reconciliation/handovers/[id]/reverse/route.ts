import { NextRequest } from 'next/server';
import { reverseCodHandover } from '../../../../../../lib/cod-reconciliation-gateway';
import { codBody, codErrorResponse, codRequestId, codResponse } from '../../../_route-helpers';

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  const requestId = codRequestId(request);
  try {
    const data = await reverseCodHandover<unknown>(context.params.id, await codBody(request), requestId, request.headers.get('idempotency-key') || '');
    return codResponse(data, requestId);
  } catch (error) { return codErrorResponse(error, requestId); }
}
