import { NextRequest } from 'next/server';
import { listSupplierPaymentTargets } from '../../../../lib/supplier-payment-gateway';
import {
  supplierPaymentErrorResponse,
  supplierPaymentRequestId,
  supplierPaymentResponse,
} from '../_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = supplierPaymentRequestId(request);
  try {
    const data = await listSupplierPaymentTargets<unknown>(requestId, {
      supplierId: request.nextUrl.searchParams.get('supplierId') || undefined,
      warehouseId: request.nextUrl.searchParams.get('warehouseId') || undefined,
      currencyCode: request.nextUrl.searchParams.get('currencyCode') || undefined,
    });
    return supplierPaymentResponse(data,requestId);
  } catch (error) {
    return supplierPaymentErrorResponse(error,requestId);
  }
}
