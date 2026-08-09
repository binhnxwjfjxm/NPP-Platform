import 'server-only';
import { deliveryCoreBaseUrl, requireDeliverySessionToken } from './internal-auth-client';
import type {
  DeliveryUser,
  DriverTripDetailResponse,
  DriverTripListResponse,
} from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SuccessEnvelope<T> = Readonly<{ data: T; requestId?: string; receivedAt?: string }>;

function validUser(user: DeliveryUser) {
  return Boolean(user.username && user.displayName && UUID_PATTERN.test(user.employeeId));
}

async function requestCore<T>(path: string, user: DeliveryUser): Promise<T> {
  if (!validUser(user)) throw new Error('DELIVERY_USER_INVALID');
  const response = await fetch(`${deliveryCoreBaseUrl()}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${requireDeliverySessionToken()}`,
      'x-request-id': `delivery-web-${crypto.randomUUID()}`,
      Accept: 'application/json',
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
