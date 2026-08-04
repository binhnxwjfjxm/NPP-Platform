import { NextRequest, NextResponse } from 'next/server';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../../../../../lib/delivery-auth';
import { recordMyDeliveryAttempt } from '../../../../../../../lib/attempt-api';
import type { RecordDeliveryAttemptPayload } from '../../../../../../../lib/types';

export const dynamic = 'force-dynamic';

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message, retryable: status >= 500 } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: { tripId: string; assignmentId: string } },
) {
  if (deliverySetupPending()) {
    return errorResponse('DELIVERY_DRIVER_SETUP_PENDING', 'Ứng dụng đang chờ hồ sơ tài xế thật', 503);
  }
  const user = authenticateDeliveryUser(request.headers.get('authorization'));
  if (!user) return errorResponse('UNAUTHORIZED', 'Không xác định được tài xế', 401);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(contentLength) || contentLength > 65_536) {
    return errorResponse('REQUEST_BODY_TOO_LARGE', 'Dữ liệu kết quả giao quá lớn', 413);
  }

  let payload: RecordDeliveryAttemptPayload;
  try {
    payload = await request.json() as RecordDeliveryAttemptPayload;
  } catch {
    return errorResponse('INVALID_JSON_BODY', 'Dữ liệu kết quả giao không hợp lệ', 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return errorResponse('INVALID_JSON_BODY', 'Dữ liệu kết quả giao không hợp lệ', 400);
  }
  const untrusted = payload as Record<string, unknown>;
  if ('driverId' in untrusted || 'employeeId' in untrusted) {
    return errorResponse('UNTRUSTED_DRIVER_IDENTITY', 'Danh tính tài xế do máy chủ xác định', 400);
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
  try {
    const data = await recordMyDeliveryAttempt(
      user,
      context.params.tripId,
      context.params.assignmentId,
      payload,
      idempotencyKey,
    );
    return NextResponse.json(
      { data },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const details = error as Error & { status?: number; code?: string };
    const status = typeof details.status === 'number' ? details.status : 503;
    return errorResponse(
      details.code || 'DELIVERY_ATTEMPT_REQUEST_FAILED',
      details.message || 'Không ghi được kết quả giao',
      status,
    );
  }
}
