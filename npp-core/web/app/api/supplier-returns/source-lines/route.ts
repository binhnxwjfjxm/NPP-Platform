import { NextRequest } from 'next/server';
import { listSupplierReturnSourceLines } from '../../../../lib/supplier-return-gateway';
import {
  supplierReturnErrorResponse,
  supplierReturnRequestId,
  supplierReturnResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = supplierReturnRequestId(request);
  try {
    const data = await listSupplierReturnSourceLines<unknown>(
      requestId,
      request.nextUrl.searchParams.get('goodsReceiptId') || '',
    );
    return supplierReturnResponse(data, requestId);
  } catch (error) {
    return supplierReturnErrorResponse(error, requestId);
  }
}
