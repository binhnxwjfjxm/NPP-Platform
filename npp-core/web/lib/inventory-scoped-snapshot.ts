import 'server-only';

import { createEmptyInventorySnapshot, type InventorySnapshot } from './inventory-types';
import {
  listInventoryBalances,
  listInventoryLots,
  listInventoryTrackingPolicies,
  listOpeningBalanceImports,
  resolveInventoryRequestId,
} from './inventory-gateway';
import {
  listInventoryTrackingPolicyCandidates,
  type InventoryTrackingPolicyCandidate,
} from './inventory-policy-candidates';

export async function loadInventoryBalancesSnapshot(): Promise<InventorySnapshot> {
  const requestId = resolveInventoryRequestId(undefined);
  const balances = await listInventoryBalances<InventorySnapshot['balances']>(
    requestId,
    new URLSearchParams({ limit: '500' }),
  );
  return { ...createEmptyInventorySnapshot(), balances };
}

export async function loadInventoryLotsSnapshot(): Promise<InventorySnapshot> {
  const requestId = resolveInventoryRequestId(undefined);
  const lots = await listInventoryLots<InventorySnapshot['lots']>(
    requestId,
    new URLSearchParams({ limit: '500' }),
  );
  return { ...createEmptyInventorySnapshot(), lots };
}

export async function loadInventoryTrackingPolicySnapshot(): Promise<{
  snapshot: InventorySnapshot;
  candidates: InventoryTrackingPolicyCandidate[];
}> {
  const requestId = resolveInventoryRequestId(undefined);
  const [trackingPolicies, candidates] = await Promise.all([
    listInventoryTrackingPolicies<InventorySnapshot['trackingPolicies']>(
      requestId,
      new URLSearchParams({ limit: '500' }),
    ),
    listInventoryTrackingPolicyCandidates(requestId),
  ]);
  return {
    snapshot: { ...createEmptyInventorySnapshot(), trackingPolicies },
    candidates,
  };
}

export async function loadInventoryOpeningBalanceSnapshot(): Promise<InventorySnapshot> {
  const requestId = resolveInventoryRequestId(undefined);
  const openingBalances = await listOpeningBalanceImports<InventorySnapshot['openingBalances']>(
    requestId,
    new URLSearchParams({ limit: '200' }),
  );
  return { ...createEmptyInventorySnapshot(), openingBalances };
}
