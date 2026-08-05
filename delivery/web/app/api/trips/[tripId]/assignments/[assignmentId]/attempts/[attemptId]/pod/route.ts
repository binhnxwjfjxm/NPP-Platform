import { NextRequest, NextResponse } from 'next/server';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../../../../../../../lib/delivery-auth';
import { attachMyProof, listMyProofs } from '../../../../../../../../../lib/pod-api';
import type { AttachProofOfDeliveryPayload } from '../../../../../../../../../lib/types';

export const dynamic = 'force-dynamic';

const MAX_POD_BODY_BYTES = 16 * 1024 * 1024;

class PodBodyError extends Error {
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
      throw new PodBodyError('INVALID_JSON_BODY', 400, 'Dữ liệu bằng chứng không hợp lệ');
    }
    if (parsedLength > MAX_POD_BODY_BYTES) {
      throw new PodBodyError('REQUEST_BODY_TOO_LARGE', 413, 'Dữ liệu bằng chứng quá lớn');
    }
  }
  if (!request.body) throw new PodBodyError('INVALID_JSON_BODY', 400, 'Dữ liệu bằng chứng không hợp lệ');

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > MAX_POD_BODY_BYTES) {
        await reader.cancel('request_body_too_large').catch(() => {});
        throw new PodBodyError('REQUEST_BODY_TOO_LARGE', 413, 'Dữ liệu bằng chứng quá lớn');
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
    throw new PodBodyError('INVALID_JSON_BODY', 400, 'Dữ liệu bằng chứng không hợp lệ');
  }
}

function authenticatedUser(request: NextRequest) {
  if (deliverySetupPending()) return null;
  return authenticateDeliveryUser(request.headers.get('authorization'));
}

export async function GET(
  request: NextRequest,
  context: { params: { tripId: string; assignmentId: string; attemptId: string } },
) {
  if (deliverySetupPending()) {
    return errorResponse('DELIVERY_DRIVER_SETUP_PENDING', 'Ứng dụng đang chờ hồ sơ tài xế thật', 503);
  }
  const user = authenticatedUser(request);
  if (!user) return errorResponse('UNAUTHORIZED', 'Không xác định được tài xế', 401);
  try {
    const proofs = await listMyProofs(
      user,
      context.params.tripId,
      context.params.assignmentId,
      context.params.attemptId,
    );
    return NextResponse.json(
      { data: { proofs } },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const details = error as Error & { status?: number; code?: string };
    return errorResponse(
      details.code || 'DELIVERY_POD_REQUEST_FAILED',
      details.message || 'Không tải được bằng chứng giao hàng',
      typeof details.status === 'number' ? details.status : 503,
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: { tripId: string; assignmentId: string; attemptId: string } },
) {
  if (deliverySetupPending()) {
    return errorResponse('DELIVERY_DRIVER_SETUP_PENDING', 'Ứng dụng đang chờ hồ sơ tài xế thật', 503);
  }
  const user = authenticatedUser(request);
  if (!user) return errorResponse('UNAUTHORIZED', 'Không xác định được tài xế', 401);

  let payload: AttachProofOfDeliveryPayload;
  try {
    payload = await readLimitedJson(request) as AttachProofOfDeliveryPayload;
  } catch (error) {
    if (error instanceof PodBodyError) return errorResponse(error.code, error.message, error.status);
    return errorResponse('INVALID_JSON_BODY', 'Dữ liệu bằng chứng không hợp lệ', 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return errorResponse('INVALID_JSON_BODY', 'Dữ liệu bằng chứng không hợp lệ', 400);
  }
  const untrusted = payload as Record<string, unknown>;
  if ('driverId' in untrusted || 'employeeId' in untrusted || 'installationId' in untrusted) {
    return errorResponse('UNTRUSTED_POD_IDENTITY', 'Danh tính do máy chủ xác định', 400);
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
  try {
    const data = await attachMyProof(
      user,
      context.params.tripId,
      context.params.assignmentId,
      context.params.attemptId,
      payload,
      idempotencyKey,
    );
    return NextResponse.json(
      { data },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const details = error as Error & { status?: number; code?: string };
    return errorResponse(
      details.code || 'DELIVERY_POD_REQUEST_FAILED',
      details.message || 'Không lưu được bằng chứng giao hàng',
      typeof details.status === 'number' ? details.status : 503,
    );
  }
}

export const podRouteInternals = Object.freeze({ MAX_POD_BODY_BYTES, readLimitedJson });
