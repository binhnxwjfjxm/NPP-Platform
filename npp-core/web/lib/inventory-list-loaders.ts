import 'server-only';

import {
  listInventoryBalances,
  listInventoryLots,
  listInventoryTrackingPolicies,
} from './inventory-gateway';
import type {
  InventoryBalance,
  InventoryLot,
  InventoryTrackingPolicy,
} from './inventory-types';
import { collectInventoryPages, withInventoryPage } from './inventory-pagination';

export const INVENTORY_BALANCE_BATCH_SIZE = 1000;
export const INVENTORY_REFERENCE_BATCH_SIZE = 1000;

export function listAllInventoryBalances(
  requestId: string,
  searchParams = new URLSearchParams(),
): Promise<InventoryBalance[]> {
  return collectInventoryPages({
    pageSize: INVENTORY_BALANCE_BATCH_SIZE,
    loadPage: (page) => listInventoryBalances<InventoryBalance[]>(
      requestId,
      withInventoryPage(searchParams, page),
    ),
  });
}

export function listAllInventoryLots(
  requestId: string,
  searchParams = new URLSearchParams(),
): Promise<InventoryLot[]> {
  return collectInventoryPages({
    pageSize: INVENTORY_REFERENCE_BATCH_SIZE,
    loadPage: (page) => listInventoryLots<InventoryLot[]>(
      requestId,
      withInventoryPage(searchParams, page),
    ),
  });
}

export function listAllInventoryTrackingPolicies(
  requestId: string,
  searchParams = new URLSearchParams(),
): Promise<InventoryTrackingPolicy[]> {
  return collectInventoryPages({
    pageSize: INVENTORY_REFERENCE_BATCH_SIZE,
    loadPage: (page) => listInventoryTrackingPolicies<InventoryTrackingPolicy[]>(
      requestId,
      withInventoryPage(searchParams, page),
    ),
  });
}
