import { NextRequest } from 'next/server';
import {
  approveSupplierReturn,
  cancelSupplierReturn,
  postSupplierReturn,
  reverseSupplierReturn,
  submitSupplierReturn,
} from '../../../../lib/supplier-return-gateway';
import {
  readSupplierReturnBody,
  supplierReturnErrorResponse,
  supplierReturnIdempotencyKey,
  supplierReturnRequestId,
  supplierReturnResponse,
} from '../_route-helpers';

export async function proxySupplierReturnAction(
  request: NextRequest,
  id: string,
  action: 'submit' | 'approve' | 'cancel' | 'post' | 'reverse',
) {
  const requestId = supplierReturnRequestId(request);
  const parsed = await readSupplierReturnBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const key = supplierReturnIdempotencyKey(request);
    const data = action === 'submit'
      ? await submitSupplierReturn<unknown>(id, requestId, key, parsed.body)
      : action === 'approve'
        ? await approveSupplierReturn<unknown>(id, requestId, key, parsed.body)
        : action === 'cancel'
          ? await cancelSupplierReturn<unknown>(id, requestId, key, parsed.body)
          : action === 'post'
            ? await postSupplierReturn<unknown>(id, requestId, key, parsed.body)
            : await reverseSupplierReturn<unknown>(id, requestId, key, parsed.body);
    return supplierReturnResponse(data, requestId);
  } catch (error) {
    return supplierReturnErrorResponse(error, requestId);
  }
}
