import { NextRequest } from 'next/server';
import {
  createSupplierReturnDraft,
  listSupplierReturns,
} from '../../../lib/supplier-return-gateway';
import {
  readSupplierReturnBody,
  supplierReturnErrorResponse,
  supplierReturnIdempotencyKey,
  supplierReturnRequestId,
  supplierReturnResponse,
} from './_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = supplierReturnRequestId(request);
  try {
    const data = await listSupplierReturns<unknown>(requestId, {
      limit: request.nextUrl.searchParams.has('limit') ? Number(request.nextUrl.searchParams.get('limit')) : undefined,
      offset: request.nextUrl.searchParams.has('offset') ? Number(request.nextUrl.searchParams.get('offset')) : undefined,
      status: request.nextUrl.searchParams.get('status') || undefined,
      supplierId: request.nextUrl.searchParams.get('supplierId') || undefined,
      warehouseId: request.nextUrl.searchParams.get('warehouseId') || undefined,
      search: request.nextUrl.searchParams.get('search') || undefined,
    });
    return supplierReturnResponse(data, requestId);
  } catch (error) {
    return supplierReturnErrorResponse(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = supplierReturnRequestId(request);
  const parsed = await readSupplierReturnBody(request, requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await createSupplierReturnDraft(
      requestId,
      parsed.body as never,
      supplierReturnIdempotencyKey(request),
    );
    return supplierReturnResponse(data, requestId, 201);
  } catch (error) {
    return supplierReturnErrorResponse(error, requestId);
  }
}
