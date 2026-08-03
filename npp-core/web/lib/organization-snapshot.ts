import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  listOrganizationResource,
  resolveOrganizationRequestId,
} from './organization-gateway';
import type {
  Branch,
  OrganizationResourceKey,
  OrganizationSnapshot,
  Warehouse,
  WarehouseLocation,
} from './organization-types';

export type OrganizationSnapshotLoadResult = {
  snapshot: OrganizationSnapshot;
  unavailable: OrganizationResourceKey[];
};

async function loadList<T>(resource: 'branches' | 'warehouses' | 'warehouse-locations'): Promise<T[]> {
  const requestId = resolveOrganizationRequestId(`web_${randomUUID()}`);
  const result = await listOrganizationResource<T[]>(resource, requestId, new URLSearchParams({ limit: '1000' }));
  return Array.isArray(result) ? result : [];
}

export async function loadOrganizationSnapshotWithStatus(): Promise<OrganizationSnapshotLoadResult> {
  const [branchResult, warehouseResult, locationResult] = await Promise.allSettled([
    loadList<Branch>('branches'),
    loadList<Warehouse>('warehouses'),
    loadList<WarehouseLocation>('warehouse-locations'),
  ]);

  const unavailable: OrganizationResourceKey[] = [];
  if (branchResult.status === 'rejected') unavailable.push('branches');
  if (warehouseResult.status === 'rejected') unavailable.push('warehouses');
  if (locationResult.status === 'rejected') unavailable.push('locations');

  if (unavailable.length === 3) {
    throw new AggregateError(
      [branchResult, warehouseResult, locationResult]
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason),
      'Không tải được dữ liệu tổ chức',
    );
  }

  return {
    snapshot: {
      branches: branchResult.status === 'fulfilled' ? branchResult.value : [],
      warehouses: warehouseResult.status === 'fulfilled' ? warehouseResult.value : [],
      locations: locationResult.status === 'fulfilled' ? locationResult.value : [],
      checkedAt: new Date().toISOString(),
    },
    unavailable,
  };
}

export async function loadOrganizationSnapshot(): Promise<OrganizationSnapshot> {
  return (await loadOrganizationSnapshotWithStatus()).snapshot;
}
