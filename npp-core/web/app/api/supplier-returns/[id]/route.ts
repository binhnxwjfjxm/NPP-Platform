import { NextRequest } from 'next/server';
import {
  getSupplierReturn,
  patchSupplierReturnDraft,
} from '../../../../lib/supplier-return-gateway';
import {
  readSupplierReturnBody,
  supplierReturnErrorResponse,
  supplierReturnIdempotencyKey,
  supplierReturnRequestId,
  supplierReturnResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = supplierReturnRequestId(request);
  try {
    return supplierReturnResponse(
      await getSupplierReturn<unknown>(params.id, requestId),
      requestId,
    );
  } catch (error) {
    return supplierReturnErrorResponse(error, requestId);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const requestId = supplierReturnRequestId(request);
  const parsed = await readSupplierReturnBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    return supplierReturnResponse(
      await patchSupplierReturnDraft<unknown>(
        params.id,
        requestId,
        parsed.body,
        supplierReturnIdempotencyKey(request),
      ),
      requestId,
    );
  } catch (error) {
    return supplierReturnErrorResponse(error, requestId);
  }
}
