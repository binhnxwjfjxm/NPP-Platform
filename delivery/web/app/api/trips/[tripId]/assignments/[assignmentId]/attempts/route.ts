import { NextRequest, NextResponse } from 'next/server';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../../../../../lib/delivery-auth';
import { recordMyDeliveryAttempt } from '../../../../../../../lib/attempt-api';
import type { RecordDeliveryAttemptPayload } from '../../../../../../../lib/types';

export const dynamic = 'force-dynamic';

const MAX_ATTEMPT_BODY_BYTES = 65_536;

class AttemptBodyError extends Error {
  constructor(
    readonly code: 'REQUEST_BODY_TOO_LARGE' | 'INVALID_JSON_BODY',
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message, retryable: status >= 500 } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function readLimitedJson(request: NextRequest): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new AttemptBodyError('INVALID_JSON_BODY', 400, 'Dữ liệu kết quả giao không hợp lệ');
    }
    if (parsedLength > MAX_ATTEMPT_BODY_BYTES) {
      throw new AttemptBodyError('REQUEST_BODY_TOO_LARGE', 413, 'Dữ liệu kết quả giao quá lớn');
    }
  }

  if (!request.body) {
    throw new AttemptBodyError('INVALID_JSON_BODY', 400, 'Dữ liệu kết quả giao không hợp lệ');
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > MAX_ATTEMPT_BODY_BYTES) {
        await reader.cancel('request_body_too_large').catch(() => {});
        throw new AttemptBodyError('REQUEST_BODY_TOO_LARGE', 413, 'Dữ liệu kết quả giao quá lớn');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AttemptBodyError('INVALID_JSON_BODY', 400, 'Dữ liệu kết quả giao không hợp lệ');
  }
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

  let payload: RecordDeliveryAttemptPayload;
  try {
    payload = await readLimitedJson(request) as RecordDeliveryAttemptPayload;
  } catch (error) {
    if (error instanceof AttemptBodyError) {
      return errorResponse(error.code, error.message, error.status);
    }
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
