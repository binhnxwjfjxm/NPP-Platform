import 'server-only';
import type {
  AttachProofOfDeliveryPayload,
  AttachProofOfDeliveryResponse,
  DeliveryUser,
  ProofOfDelivery,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

type SuccessEnvelope<T> = Readonly<{ data: T }>;

function config() {
  const rawUrl = process.env.CORE_API_INTERNAL_URL?.trim();
  const credential = process.env.DELIVERY_CORE_API_TOKEN?.trim();
  if (!rawUrl || !credential) throw new Error('DELIVERY_CORE_CONFIG_NOT_READY');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DELIVERY_CORE_URL_INVALID');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('DELIVERY_CORE_URL_INVALID');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('DELIVERY_CORE_HTTPS_REQUIRED');
  }
  return Object.freeze({ baseUrl: url.toString().replace(/\/$/, ''), credential });
}

function assertLineage(user: DeliveryUser, tripId: string, assignmentId: string, attemptId: string) {
  if (!UUID_PATTERN.test(user.employeeId)) throw new Error('DELIVERY_USER_INVALID');
  if (!UUID_PATTERN.test(tripId)) throw new Error('INVALID_TRIP_ID');
  if (!UUID_PATTERN.test(assignmentId)) throw new Error('INVALID_ASSIGNMENT_ID');
  if (!UUID_PATTERN.test(attemptId)) throw new Error('INVALID_DELIVERY_ATTEMPT_ID');
}

async function coreRequest<T>(
  user: DeliveryUser,
  tripId: string,
  assignmentId: string,
  attemptId: string,
  init: RequestInit,
): Promise<T> {
  assertLineage(user, tripId, assignmentId, attemptId);
  const core = config();
  const response = await fetch(
    `${core.baseUrl}/api/logistics/driver/trips/${encodeURIComponent(tripId)}`
      + `/assignments/${encodeURIComponent(assignmentId)}`
      + `/attempts/${encodeURIComponent(attemptId)}/pod`,
    {
      ...init,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${core.credential}`,
        'x-npp-delivery-employee-id': user.employeeId,
        'x-request-id': `delivery-web-pod-${crypto.randomUUID()}`,
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    },
  );
  const body = await response.json().catch(() => null) as (
    SuccessEnvelope<T> & { error?: { code?: string; message?: string } }
  ) | null;
  if (!response.ok || !body?.data) {
    const error = new Error(body?.error?.message || body?.error?.code || 'DELIVERY_POD_REQUEST_FAILED');
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = body?.error?.code;
    throw error;
  }
  return body.data;
}

export async function listMyProofs(
  user: DeliveryUser,
  tripId: string,
  assignmentId: string,
  attemptId: string,
): Promise<readonly ProofOfDelivery[]> {
  const data = await coreRequest<{ proofs: readonly ProofOfDelivery[] }>(
    user,
    tripId,
    assignmentId,
    attemptId,
    { method: 'GET' },
  );
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
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) throw new Error('INVALID_IDEMPOTENCY_KEY');
  return coreRequest<AttachProofOfDeliveryResponse>(
    user,
    tripId,
    assignmentId,
    attemptId,
    {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
}
