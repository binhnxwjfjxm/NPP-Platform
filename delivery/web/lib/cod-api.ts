import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { deliveryCoreBaseUrl, requireDeliverySessionToken } from './internal-auth-client';
import type {
  CreateCodHandoverPayload,
  DeliveryUser,
  DriverCodOverview,
  RecordCodCollectionPayload,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SuccessEnvelope<T> = Readonly<{ data: T }>;
type CoreError = Error & { status?: number; code?: string };

async function callCore<T>(
  user: DeliveryUser,
  path: string,
  init: RequestInit = {},
  idempotencyKey?: string,
): Promise<T> {
  if (!UUID_PATTERN.test(user.employeeId)) throw new Error('DELIVERY_USER_INVALID');
  const normalizedIdempotencyKey = idempotencyKey === undefined
    ? null
    : normalizeIdempotencyKey(idempotencyKey);
  if (idempotencyKey !== undefined && (!normalizedIdempotencyKey || !isValidIdempotencyKey(normalizedIdempotencyKey))) {
    throw new Error('INVALID_IDEMPOTENCY_KEY');
  }
  const response = await fetch(`${deliveryCoreBaseUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${requireDeliverySessionToken()}`,
      'x-request-id': `delivery-web-cod-${crypto.randomUUID()}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(normalizedIdempotencyKey ? { 'Idempotency-Key': normalizedIdempotencyKey } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null) as (SuccessEnvelope<T> & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok || !body?.data) {
    const error = new Error(body?.error?.message || body?.error?.code || 'DELIVERY_CORE_REQUEST_FAILED') as CoreError;
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }
  return body.data;
}

export async function getMyCodOverview(user: DeliveryUser, tripId: string): Promise<DriverCodOverview> {
  if (!UUID_PATTERN.test(tripId)) throw new Error('INVALID_TRIP_ID');
  return callCore<DriverCodOverview>(user, `/api/logistics/driver/trips/${encodeURIComponent(tripId)}/cod`);
}

export async function recordMyCodCollection(
  user: DeliveryUser,
  tripId: string,
  assignmentId: string,
  payload: RecordCodCollectionPayload,
  idempotencyKey: string,
) {
  if (!UUID_PATTERN.test(tripId)) throw new Error('INVALID_TRIP_ID');
  if (!UUID_PATTERN.test(assignmentId)) throw new Error('INVALID_ASSIGNMENT_ID');
  return callCore(user,
    `/api/logistics/driver/trips/${encodeURIComponent(tripId)}/assignments/${encodeURIComponent(assignmentId)}/cod-collections`,
    { method: 'POST', body: JSON.stringify(payload) },
    idempotencyKey,
  );
}

export async function createMyCodHandover(
  user: DeliveryUser,
  tripId: string,
  payload: CreateCodHandoverPayload,
  idempotencyKey: string,
) {
  if (!UUID_PATTERN.test(tripId)) throw new Error('INVALID_TRIP_ID');
  return callCore(user,
    `/api/logistics/driver/trips/${encodeURIComponent(tripId)}/cod-handovers`,
    { method: 'POST', body: JSON.stringify(payload) },
    idempotencyKey,
  );
}
