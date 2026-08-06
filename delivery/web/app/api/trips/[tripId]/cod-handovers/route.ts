import { NextRequest, NextResponse } from 'next/server';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../../../lib/delivery-auth';
import { createMyCodHandover } from '../../../../../lib/cod-api';
import type { CreateCodHandoverPayload } from '../../../../../lib/types';

export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 65_536;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message, retryable: status >= 500 } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest, context: { params: { tripId: string } }) {
  if (deliverySetupPending()) return errorResponse('DELIVERY_DRIVER_SETUP_PENDING', 'Ứng dụng đang chờ hồ sơ tài xế thật', 503);
  const user = authenticateDeliveryUser(request.headers.get('authorization'));
  if (!user) return errorResponse('UNAUTHORIZED', 'Không xác định được tài xế', 401);
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return errorResponse('REQUEST_BODY_TOO_LARGE', 'Dữ liệu bàn giao COD quá lớn', 413);
  let payload: CreateCodHandoverPayload;
  try { payload = JSON.parse(raw) as CreateCodHandoverPayload; } catch { return errorResponse('INVALID_JSON_BODY', 'Dữ liệu bàn giao COD không hợp lệ', 400); }
  const untrusted = payload as unknown as Record<string, unknown>;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || 'driverId' in untrusted || 'employeeId' in untrusted || 'warehouseId' in untrusted) {
    return errorResponse('UNTRUSTED_COD_SCOPE', 'Tài xế và kho do máy chủ xác định', 400);
  }
  try {
    const data = await createMyCodHandover(user, context.params.tripId, payload, request.headers.get('idempotency-key')?.trim() || '');
    return NextResponse.json({ data }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const details = error as Error & { status?: number; code?: string };
    return errorResponse(details.code || 'DELIVERY_COD_HANDOVER_FAILED', details.message || 'Không lập được bàn giao COD', details.status || 503);
  }
}
