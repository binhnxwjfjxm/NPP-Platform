import 'server-only';
import { isValidIdempotencyKey, normalizeIdempotencyKey } from '@npp/contracts';
import { deliveryCoreBaseUrl, requireDeliverySessionToken } from './internal-auth-client';
import type { DeliveryUser } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SuccessEnvelope<T> = Readonly<{ data: T }>;
type CoreError = Error & { status?: number; code?: string };

export type PickingWorkItem = Readonly<{
  fulfillmentDemandId: string;
  salesOrderId: string;
  orderNumber: string;
  fulfillmentStatus: string;
  requestedDeliveryDate: string | null;
  sourceType: string | null;
  customerCode: string | null;
  customerName: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  salesOrderVersionId: string;
  salesOrderLineId: string;
  lineNumber: number;
  itemName: string | null;
  sku: string | null;
  unitCode: string | null;
  baseVariantId: string;
  orderedBaseQuantity: string;
  reservedBaseQuantity: string;
  backorderedBaseQuantity: string;
  allocatedBaseQuantity: string;
  pickedBaseQuantity: string;
  packedBaseQuantity: string;
  allocationCount: number;
  createdAt: string;
  updatedAt: string;
}>;

export type PickingCandidate = Readonly<{
  rank: number;
  warehouseId: string;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  baseVariantId: string;
  lotId: string | null;
  lotCode: string | null;
  expiryDate: string | null;
  firstReceivedAt: string | null;
  availableBaseQuantity: string;
  allocationPolicy: string;
  lotTrackingMode: string;
  expiryTrackingMode: string;
  locationRequired: boolean;
}>;

export type PickingAllocation = Readonly<{
  id: string;
  fulfillmentDemandId: string;
  salesOrderId: string;
  warehouseId: string;
  locationId: string | null;
  locationCode: string | null;
  locationName: string | null;
  lotId: string | null;
  lotCode: string | null;
  allocatedBaseQuantity: string;
  pickedBaseQuantity: string;
  packedBaseQuantity: string;
  state: string;
}>;

export type PickingDemandDetail = Readonly<{
  ok: true;
  demand: PickingWorkItem;
  remainingBaseQuantity: string;
  candidates: readonly PickingCandidate[];
  suggestedPlan: readonly unknown[];
  allocations: readonly PickingAllocation[];
}>;

export type PickingCloseState = Readonly<{
  ok: true;
  canCloseFull: boolean;
  canClosePartial: boolean;
  reasonCode: string | null;
  orderedBaseQuantity: string;
  allocatedBaseQuantity: string;
  pickedBaseQuantity: string;
  remainingBaseQuantity: string;
  backorderedBaseQuantity: string;
  shortageCount: number;
  alternativeSources: readonly PickingCandidate[];
  latestCloseMode: 'FULL' | 'PARTIAL' | null;
}>;

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
      'x-request-id': `delivery-web-picking-${crypto.randomUUID()}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(normalizedIdempotencyKey ? { 'Idempotency-Key': normalizedIdempotencyKey } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null) as (SuccessEnvelope<T> & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok || !body || !('data' in body)) {
    const error = new Error(body?.error?.message || body?.error?.code || 'DELIVERY_FULFILLMENT_REQUEST_FAILED') as CoreError;
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }
  return body.data;
}

export function listPickingWork(user: DeliveryUser): Promise<readonly PickingWorkItem[]> {
  return callCore<readonly PickingWorkItem[]>(user, '/api/inventory/fulfillment-work?limit=200&offset=0');
}

export function getPickingDemand(user: DeliveryUser, demandId: string): Promise<PickingDemandDetail> {
  if (!UUID_PATTERN.test(demandId)) throw new Error('INVALID_FULFILLMENT_DEMAND_ID');
  return callCore<PickingDemandDetail>(
    user,
    `/api/inventory/fulfillment-demands/${encodeURIComponent(demandId)}/suggestions`,
  );
}

export function getPickingCloseState(user: DeliveryUser, salesOrderId: string): Promise<PickingCloseState> {
  if (!UUID_PATTERN.test(salesOrderId)) throw new Error('INVALID_SALES_ORDER_ID');
  return callCore<PickingCloseState>(
    user,
    `/api/inventory/fulfillment-orders/${encodeURIComponent(salesOrderId)}/picking-close-state`,
  );
}

export function pickFulfillmentAllocation(
  user: DeliveryUser,
  allocationId: string,
  payload: Readonly<{ quantity: string; reason?: string | null }>,
  idempotencyKey: string,
) {
  if (!UUID_PATTERN.test(allocationId)) throw new Error('INVALID_FULFILLMENT_ALLOCATION_ID');
  return callCore(user,
    `/api/inventory/fulfillment-allocations/${encodeURIComponent(allocationId)}/pick`,
    { method: 'POST', body: JSON.stringify(payload) },
    idempotencyKey,
  );
}

export function recordFulfillmentShortage(
  user: DeliveryUser,
  allocationId: string,
  payload: Readonly<{ actualPickedQuantity: string; observedQuantity: string; reason: string }>,
  idempotencyKey: string,
) {
  if (!UUID_PATTERN.test(allocationId)) throw new Error('INVALID_FULFILLMENT_ALLOCATION_ID');
  return callCore(user,
    `/api/inventory/fulfillment-allocations/${encodeURIComponent(allocationId)}/shortage`,
    { method: 'POST', body: JSON.stringify(payload) },
    idempotencyKey,
  );
}

export function closeFulfillmentPicking(
  user: DeliveryUser,
  salesOrderId: string,
  payload: Readonly<{ mode: 'FULL' | 'PARTIAL' }>,
  idempotencyKey: string,
) {
  if (!UUID_PATTERN.test(salesOrderId)) throw new Error('INVALID_SALES_ORDER_ID');
  return callCore(user,
    `/api/inventory/fulfillment-orders/${encodeURIComponent(salesOrderId)}/picking-close`,
    { method: 'POST', body: JSON.stringify(payload) },
    idempotencyKey,
  );
}
