import { NextRequest } from 'next/server';
import { getCodHandover } from '../../../../lib/cod-reconciliation-gateway';
import { codErrorResponse, codRequestId, codResponse } from '../_route-helpers';

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  const requestId = codRequestId(request);
  try { return codResponse(await getCodHandover<unknown>(context.params.id, requestId), requestId); }
  catch (error) { return codErrorResponse(error, requestId); }
}
