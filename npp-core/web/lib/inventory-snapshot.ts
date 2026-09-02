import 'server-only';

import { createEmptyInventorySnapshot, type InventorySnapshot } from './inventory-types';
import {
  listOpeningBalanceImports,
  resolveInventoryRequestId,
} from './inventory-gateway';
import {
  listAllInventoryBalances,
  listAllInventoryLots,
  listAllInventoryTrackingPolicies,
} from './inventory-list-loaders';

export async function loadInventorySnapshot(): Promise<InventorySnapshot> {
  const requestId = resolveInventoryRequestId(undefined);
  const [trackingPolicies, lots, balances, openingBalances] = await Promise.all([
    listAllInventoryTrackingPolicies(requestId),
    listAllInventoryLots(requestId),
    listAllInventoryBalances(requestId),
    listOpeningBalanceImports<InventorySnapshot['openingBalances']>(requestId, new URLSearchParams({ limit: '200' })),
  ]);

  return {
    ...createEmptyInventorySnapshot(),
    trackingPolicies,
    lots,
    balances,
    openingBalances,
  };
}
