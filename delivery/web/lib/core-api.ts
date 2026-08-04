import 'server-only';
import type {
  DeliveryUser,
  DriverTripDetailResponse,
  DriverTripListResponse,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SuccessEnvelope<T> = Readonly<{ data: T; requestId?: string; receivedAt?: string }>;

function coreConfig() {
  const rawUrl = process.env.CORE_API_INTERNAL_URL?.trim();
  const token = process.env.DELIVERY_CORE_API_TOKEN?.trim();
  if (!rawUrl || !token) throw new Error('DELIVERY_CORE_CONFIG_NOT_READY');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DELIVERY_CORE_URL_INVALID');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('DELIVERY_CORE_URL_INVALID');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('DELIVERY_CORE_HTTPS_REQUIRED');
  }
  return Object.freeze({ baseUrl: url.toString().replace(/\/$/, ''), token });
}

function validUser(user: DeliveryUser) {
  return Boolean(user.username && user.displayName && UUID_PATTERN.test(user.employeeId));
}

async function requestCore<T>(path: string, user: DeliveryUser): Promise<T> {
  if (!validUser(user)) throw new Error('DELIVERY_USER_INVALID');
  const config = coreConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'x-npp-delivery-employee-id': user.employeeId,
      'x-request-id': `delivery-web-${crypto.randomUUID()}`,
    },
    cache: 'no-store',
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('DELIVERY_CORE_INVALID_RESPONSE');
  }
  if (!response.ok) {
    const errorPayload = payload as { error?: { code?: string } };
    const error = new Error(errorPayload.error?.code || 'DELIVERY_CORE_REQUEST_FAILED');
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const envelope = payload as SuccessEnvelope<T>;
  if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) {
    throw new Error('DELIVERY_CORE_INVALID_RESPONSE');
  }
  return envelope.data;
}

export function listMyTrips(user: DeliveryUser): Promise<DriverTripListResponse> {
  return requestCore<DriverTripListResponse>('/api/logistics/driver/trips?limit=100&offset=0', user);
}

export function getMyTrip(user: DeliveryUser, tripId: string): Promise<DriverTripDetailResponse> {
  if (!UUID_PATTERN.test(tripId)) throw new Error('INVALID_TRIP_ID');
  return requestCore<DriverTripDetailResponse>(`/api/logistics/driver/trips/${encodeURIComponent(tripId)}`, user);
}
