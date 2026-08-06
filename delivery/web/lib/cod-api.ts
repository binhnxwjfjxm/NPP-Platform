import 'server-only';
import type {
  CreateCodHandoverPayload,
  DeliveryUser,
  DriverCodOverview,
  RecordCodCollectionPayload,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

type SuccessEnvelope<T> = Readonly<{ data: T }>;

type CoreError = Error & { status?: number; code?: string };

function config() {
  const rawUrl = process.env.CORE_API_INTERNAL_URL?.trim();
  const credential = process.env.DELIVERY_CORE_API_TOKEN?.trim();
  if (!rawUrl || !credential) throw new Error('DELIVERY_CORE_CONFIG_NOT_READY');
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('DELIVERY_CORE_URL_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('DELIVERY_CORE_URL_INVALID');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('DELIVERY_CORE_HTTPS_REQUIRED');
  return Object.freeze({ baseUrl: url.toString().replace(/\/$/, ''), credential });
}

async function callCore<T>(
  user: DeliveryUser,
  path: string,
  init: RequestInit = {},
  idempotencyKey?: string,
): Promise<T> {
  if (!UUID_PATTERN.test(user.employeeId)) throw new Error('DELIVERY_USER_INVALID');
  if (idempotencyKey !== undefined && !IDEMPOTENCY_PATTERN.test(idempotencyKey)) throw new Error('INVALID_IDEMPOTENCY_KEY');
  const core = config();
  const response = await fetch(`${core.baseUrl}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${core.credential}`,
      'x-npp-delivery-employee-id': user.employeeId,
      'x-request-id': `delivery-web-cod-${crypto.randomUUID()}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
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
