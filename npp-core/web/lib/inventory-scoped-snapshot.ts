import 'server-only';

import { createEmptyInventorySnapshot, type InventorySnapshot } from './inventory-types';
import {
  listInventoryBalances as listInventoryBalancesPage,
  listInventoryLots as listInventoryLotsPage,
  listInventoryTrackingPolicies as listInventoryTrackingPoliciesPage,
  listOpeningBalanceImports,
  resolveInventoryRequestId,
} from './inventory-gateway';
import { collectInventoryPages } from './inventory-pagination';
import {
  listInventoryTrackingPolicyCandidates,
  type InventoryTrackingPolicyCandidate,
} from './inventory-policy-candidates';

const INVENTORY_BALANCE_BATCH_SIZE = 1000;
const INVENTORY_REFERENCE_BATCH_SIZE = 1000;

async function listAllInventoryBalances(requestId: string): Promise<InventorySnapshot['balances']> {
  return collectInventoryPages({
    pageSize: INVENTORY_BALANCE_BATCH_SIZE,
    loadPage: ({ offset }) => listInventoryBalancesPage<InventorySnapshot['balances']>(
      requestId,
      new URLSearchParams({
        limit: String(INVENTORY_BALANCE_BATCH_SIZE),
        offset: String(offset),
      }),
    ),
  });
}

async function listInventoryLots(requestId: string): Promise<InventorySnapshot['lots']> {
  return collectInventoryPages({
    pageSize: INVENTORY_REFERENCE_BATCH_SIZE,
    loadPage: ({ offset }) => listInventoryLotsPage<InventorySnapshot['lots']>(
      requestId,
      new URLSearchParams({
        limit: String(INVENTORY_REFERENCE_BATCH_SIZE),
        offset: String(offset),
      }),
    ),
  });
}

async function listInventoryTrackingPolicies(requestId: string): Promise<InventorySnapshot['trackingPolicies']> {
  return collectInventoryPages({
    pageSize: INVENTORY_REFERENCE_BATCH_SIZE,
    loadPage: ({ offset }) => listInventoryTrackingPoliciesPage<InventorySnapshot['trackingPolicies']>(
      requestId,
      new URLSearchParams({
        limit: String(INVENTORY_REFERENCE_BATCH_SIZE),
        offset: String(offset),
      }),
    ),
  });
}

export async function loadInventoryBalancesSnapshot(): Promise<InventorySnapshot> {
  const requestId = resolveInventoryRequestId(undefined);
  const balances = await listAllInventoryBalances(requestId);
  return { ...createEmptyInventorySnapshot(), balances };
}

export async function loadInventoryLotsSnapshot(): Promise<InventorySnapshot> {
  const requestId = resolveInventoryRequestId(undefined);
  const lots = await listInventoryLots(requestId);
  return { ...createEmptyInventorySnapshot(), lots };
}

export async function loadInventoryTrackingPolicySnapshot(): Promise<{
  snapshot: InventorySnapshot;
  candidates: InventoryTrackingPolicyCandidate[];
}> {
  const requestId = resolveInventoryRequestId(undefined);
  const [trackingPolicies, candidates] = await Promise.all([
    listInventoryTrackingPolicies(requestId),
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
