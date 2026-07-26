import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  listOrganizationResource,
  resolveOrganizationRequestId,
} from './organization-gateway';
import type {
  Branch,
  OrganizationSnapshot,
  Warehouse,
  WarehouseLocation,
} from './organization-types';

async function loadList<T>(resource: 'branches' | 'warehouses' | 'warehouse-locations'): Promise<T[]> {
  const requestId = resolveOrganizationRequestId(`web_${randomUUID()}`);
  const result = await listOrganizationResource<T[]>(resource, requestId, new URLSearchParams({ limit: '1000' }));
  return Array.isArray(result) ? result : [];
}

export async function loadOrganizationSnapshot(): Promise<OrganizationSnapshot> {
  const [branches, warehouses, locations] = await Promise.all([
    loadList<Branch>('branches'),
    loadList<Warehouse>('warehouses'),
    loadList<WarehouseLocation>('warehouse-locations'),
  ]);

  return {
    branches,
    warehouses,
    locations,
    checkedAt: new Date().toISOString(),
  };
}

