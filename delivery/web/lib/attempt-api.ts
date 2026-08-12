import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { deliveryCoreBaseUrl, requireDeliverySessionToken } from './internal-auth-client';
import type {
  DeliveryUser,
  RecordDeliveryAttemptPayload,
  RecordDeliveryAttemptResponse,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SuccessEnvelope<T> = Readonly<{ data: T }>;

export async function recordMyDeliveryAttempt(
  user: DeliveryUser,
  tripId: string,
  assignmentId: string,
  payload: RecordDeliveryAttemptPayload,
  idempotencyKey: string,
): Promise<RecordDeliveryAttemptResponse> {
  if (!UUID_PATTERN.test(user.employeeId)) throw new Error('DELIVERY_USER_INVALID');
  if (!UUID_PATTERN.test(tripId)) throw new Error('INVALID_TRIP_ID');
  if (!UUID_PATTERN.test(assignmentId)) throw new Error('INVALID_ASSIGNMENT_ID');
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  if (!normalizedIdempotencyKey || !isValidIdempotencyKey(normalizedIdempotencyKey)) throw new Error('INVALID_IDEMPOTENCY_KEY');

  const response = await fetch(
    `${deliveryCoreBaseUrl()}/api/logistics/driver/trips/${encodeURIComponent(tripId)}/assignments/${encodeURIComponent(assignmentId)}/attempts`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${requireDeliverySessionToken()}`,
        'x-request-id': `delivery-web-attempt-${crypto.randomUUID()}`,
        'Idempotency-Key': normalizedIdempotencyKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await response.json().catch(() => null) as (
    SuccessEnvelope<RecordDeliveryAttemptResponse>
    & { error?: { code?: string; message?: string } }
  ) | null;
  if (!response.ok || !body?.data) {
    const error = new Error(body?.error?.message || body?.error?.code || 'DELIVERY_CORE_REQUEST_FAILED');
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = body?.error?.code;
    throw error;
  }
  return body.data;
}
