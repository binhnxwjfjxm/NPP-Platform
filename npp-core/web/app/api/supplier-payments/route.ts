import { NextRequest } from 'next/server';
import {
  createSupplierPayment,
  listSupplierPayments,
} from '../../../lib/supplier-payment-gateway';
import type { SupplierPaymentDraft } from '../../../lib/supplier-payment-types';
import {
  readSupplierPaymentBody,
  supplierPaymentErrorResponse,
  supplierPaymentIdempotencyKey,
  supplierPaymentRequestId,
  supplierPaymentResponse,
} from './_route-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = supplierPaymentRequestId(request);
  try {
    const data = await listSupplierPayments<unknown>(requestId, {
      limit: request.nextUrl.searchParams.has('limit') ? Number(request.nextUrl.searchParams.get('limit')) : undefined,
      offset: request.nextUrl.searchParams.has('offset') ? Number(request.nextUrl.searchParams.get('offset')) : undefined,
      supplierId: request.nextUrl.searchParams.get('supplierId') || undefined,
      warehouseId: request.nextUrl.searchParams.get('warehouseId') || undefined,
      status: request.nextUrl.searchParams.get('status') || undefined,
      currencyCode: request.nextUrl.searchParams.get('currencyCode') || undefined,
      search: request.nextUrl.searchParams.get('search') || undefined,
    });
    return supplierPaymentResponse(data,requestId);
  } catch (error) {
    return supplierPaymentErrorResponse(error,requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = supplierPaymentRequestId(request);
  const parsed = await readSupplierPaymentBody(request,requestId);
  if (!parsed.ok) return parsed.response;
  try {
    const data = await createSupplierPayment<unknown>(
      requestId,
      parsed.body as SupplierPaymentDraft,
      supplierPaymentIdempotencyKey(request),
    );
    return supplierPaymentResponse(data,requestId,201);
  } catch (error) {
    return supplierPaymentErrorResponse(error,requestId);
  }
}
