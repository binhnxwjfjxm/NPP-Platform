import 'server-only';

import { createEmptyInventorySnapshot, type InventorySnapshot } from './inventory-types';
import {
  listInventoryBalances,
  listInventoryLots,
  listInventoryTrackingPolicies,
  listOpeningBalanceImports,
  resolveInventoryRequestId,
} from './inventory-gateway';

export async function loadInventorySnapshot(): Promise<InventorySnapshot> {
  const requestId = resolveInventoryRequestId(undefined);
  const [trackingPolicies, lots, balances, openingBalances] = await Promise.all([
    listInventoryTrackingPolicies<InventorySnapshot['trackingPolicies']>(requestId, new URLSearchParams({ limit: '500' })),
    listInventoryLots<InventorySnapshot['lots']>(requestId, new URLSearchParams({ limit: '500' })),
    listInventoryBalances<InventorySnapshot['balances']>(requestId, new URLSearchParams({ limit: '500' })),
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
