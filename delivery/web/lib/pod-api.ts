import 'server-only';
import { deliveryCoreBaseUrl, requireDeliverySessionToken } from './internal-auth-client';
import type {
  AttachProofOfDeliveryPayload,
  AttachProofOfDeliveryResponse,
  DeliveryUser,
  ProofOfDelivery,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const CORE_REQUEST_TIMEOUT_MS = 30_000;

type SuccessEnvelope<T> = Readonly<{ data: T }>;

export class DeliveryPodGatewayError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'DeliveryPodGatewayError';
    this.code = code;
    this.status = status;
  }
}

function assertLineage(user: DeliveryUser, tripId: string, assignmentId: string, attemptId: string) {
  if (!UUID_PATTERN.test(user.employeeId)) throw new DeliveryPodGatewayError('DELIVERY_USER_INVALID', 'Danh tính tài xế không hợp lệ', 400);
  if (!UUID_PATTERN.test(tripId)) throw new DeliveryPodGatewayError('INVALID_TRIP_ID', 'Mã chuyến không hợp lệ', 400);
  if (!UUID_PATTERN.test(assignmentId)) throw new DeliveryPodGatewayError('INVALID_ASSIGNMENT_ID', 'Mã phiếu giao không hợp lệ', 400);
  if (!UUID_PATTERN.test(attemptId)) throw new DeliveryPodGatewayError('INVALID_DELIVERY_ATTEMPT_ID', 'Mã lần giao không hợp lệ', 400);
}

async function coreRequest<T>(
  user: DeliveryUser,
  tripId: string,
  assignmentId: string,
  attemptId: string,
  init: RequestInit,
): Promise<T> {
  assertLineage(user, tripId, assignmentId, attemptId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CORE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${deliveryCoreBaseUrl()}/api/logistics/driver/trips/${encodeURIComponent(tripId)}`
        + `/assignments/${encodeURIComponent(assignmentId)}`
        + `/attempts/${encodeURIComponent(attemptId)}/pod`,
      {
        ...init,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${requireDeliverySessionToken()}`,
          'x-request-id': `delivery-web-pod-${crypto.randomUUID()}`,
          Accept: 'application/json',
          ...(init.headers ?? {}),
        },
      },
    );
    const body = await response.json().catch(() => null) as (SuccessEnvelope<T> & { error?: { code?: string; message?: string } }) | null;
    if (!response.ok || !body?.data) {
      throw new DeliveryPodGatewayError(
        body?.error?.code || 'DELIVERY_POD_REQUEST_FAILED',
        body?.error?.message || 'Không xử lý được bằng chứng giao hàng',
        response.status,
      );
    }
    return body.data;
  } catch (error) {
    if (error instanceof DeliveryPodGatewayError) throw error;
    throw new DeliveryPodGatewayError('DELIVERY_POD_GATEWAY_UNAVAILABLE', 'Cổng bằng chứng giao hàng tạm thời không khả dụng', 503);
  } finally {
    clearTimeout(timeout);
  }
}

export async function listMyProofs(
  user: DeliveryUser,
  tripId: string,
  assignmentId: string,
  attemptId: string,
): Promise<readonly ProofOfDelivery[]> {
  const data = await coreRequest<{ proofs: readonly ProofOfDelivery[] }>(user, tripId, assignmentId, attemptId, { method: 'GET' });
  return data.proofs;
}

export async function attachMyProof(
  user: DeliveryUser,
  tripId: string,
  assignmentId: string,
  attemptId: string,
  payload: AttachProofOfDeliveryPayload,
  idempotencyKey: string,
): Promise<AttachProofOfDeliveryResponse> {
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    throw new DeliveryPodGatewayError('INVALID_IDEMPOTENCY_KEY', 'Khóa chống ghi trùng không hợp lệ', 400);
  }
  return coreRequest<AttachProofOfDeliveryResponse>(user, tripId, assignmentId, attemptId, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export const podApiInternals = Object.freeze({ CORE_REQUEST_TIMEOUT_MS });
