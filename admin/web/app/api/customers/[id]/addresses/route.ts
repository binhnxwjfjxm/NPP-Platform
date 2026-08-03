import { NextResponse } from 'next/server';
import { CoreApiError, listCustomerAddresses } from '@/lib/core-api';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const data = await listCustomerAddresses(params.id);
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const normalized = error instanceof CoreApiError
      ? error
      : new CoreApiError('ADMIN_CUSTOMER_ADDRESS_FAILED', 'Không tải được địa chỉ khách hàng', 503, true);
    return NextResponse.json({ error: { code: normalized.code, message: normalized.publicMessage, retryable: normalized.retryable } }, { status: normalized.statusCode, headers: { 'Cache-Control': 'no-store' } });
  }
}
