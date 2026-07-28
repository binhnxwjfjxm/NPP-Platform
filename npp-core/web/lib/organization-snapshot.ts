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
  const [branchResult, warehouseResult, locationResult] = await Promise.allSettled([
    loadList<Branch>('branches'),
    loadList<Warehouse>('warehouses'),
    loadList<WarehouseLocation>('warehouse-locations'),
  ]);

  if (
    branchResult.status === 'rejected'
    && warehouseResult.status === 'rejected'
    && locationResult.status === 'rejected'
  ) {
    throw new AggregateError(
      [branchResult.reason, warehouseResult.reason, locationResult.reason],
      'Không tải được dữ liệu tổ chức',
    );
  }

  return {
    branches: branchResult.status === 'fulfilled' ? branchResult.value : [],
    warehouses: warehouseResult.status === 'fulfilled' ? warehouseResult.value : [],
    locations: locationResult.status === 'fulfilled' ? locationResult.value : [],
    checkedAt: new Date().toISOString(),
  };
}
