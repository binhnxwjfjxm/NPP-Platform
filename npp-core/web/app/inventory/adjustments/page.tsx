import { headers } from 'next/headers';
import { listAllInventoryBalances } from '../../../lib/inventory-list-loaders';
import { loadOrganizationSnapshot } from '../../../lib/organization-snapshot';
import {
  listInventoryAdjustmentReasons,
  listInventoryAdjustments,
  resolveInventoryAdjustmentRequestId,
} from '../../../lib/inventory-adjustment-gateway';
import type { AdjustmentReason, InventoryAdjustment } from '../../../lib/inventory-adjustment-types';
import type { InventoryBalance } from '../../../lib/inventory-types';
import type { Warehouse, WarehouseLocation } from '../../../lib/organization-types';
import InventoryAdjustmentWorkspace from './workspace';

export const dynamic = 'force-dynamic';

type PageSearchParams = Promise<{
  tab?: string;
  adjustment?: string;
  created?: string;
}>;

export default async function InventoryAdjustmentsPage({ searchParams }: { searchParams: PageSearchParams }) {
  const [{ tab, adjustment, created }, headerStore] = await Promise.all([searchParams, headers()]);
  const requestId = resolveInventoryAdjustmentRequestId(headerStore.get('x-request-id'));
  let adjustments: InventoryAdjustment[] = [];
  let reasons: AdjustmentReason[] = [];
  let balances: InventoryBalance[] = [];
  let warehouses: Warehouse[] = [];
  let locations: WarehouseLocation[] = [];
  let initialError: string | null = null;
  try {
    const [adjustmentData, reasonData, balanceData, organization] = await Promise.all([
      listInventoryAdjustments<InventoryAdjustment[]>(requestId),
      listInventoryAdjustmentReasons<AdjustmentReason[]>(requestId),
      listAllInventoryBalances(requestId),
      loadOrganizationSnapshot(),
    ]);
    adjustments = adjustmentData;
    reasons = reasonData;
    balances = balanceData;
    warehouses = organization.warehouses.filter((item) => item.is_active);
    locations = organization.locations.filter((item) => item.is_active);
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu xử lý tồn kho';
  }
  return <InventoryAdjustmentWorkspace
    initialAdjustments={adjustments}
    reasons={reasons}
    balances={balances}
    warehouses={warehouses}
    locations={locations}
    initialError={initialError}
    initialTab={tab === 'manual' ? 'manual' : 'documents'}
    initialAdjustmentId={adjustment?.trim() || null}
    createdSummary={created?.trim() || null}
  />;
}
