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

const INVENTORY_BALANCE_BATCH_SIZE = 1000;
const INVENTORY_BALANCE_MAX_OFFSET = 100000;

async function listAllInventoryBalances(requestId: string): Promise<InventorySnapshot['balances']> {
  const balances: InventorySnapshot['balances'] = [];
  for (let offset = 0; offset <= INVENTORY_BALANCE_MAX_OFFSET; offset += INVENTORY_BALANCE_BATCH_SIZE) {
    const batch = await listInventoryBalances<InventorySnapshot['balances']>(
      requestId,
      new URLSearchParams({
        limit: String(INVENTORY_BALANCE_BATCH_SIZE),
        offset: String(offset),
      }),
    );
    balances.push(...batch);
    if (batch.length < INVENTORY_BALANCE_BATCH_SIZE) return balances;
  }
  throw new Error('Dữ liệu tồn kho vượt phạm vi tra cứu an toàn. Vui lòng liên hệ quản trị hệ thống.');
}

export async function loadInventoryBalancesSnapshot(): Promise<InventorySnapshot> {
  const requestId = resolveInventoryRequestId(undefined);
  const balances = await listAllInventoryBalances(requestId);
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
