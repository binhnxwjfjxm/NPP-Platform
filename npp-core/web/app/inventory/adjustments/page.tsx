import { headers } from 'next/headers';
import { loadInventorySnapshot } from '../../../lib/inventory-snapshot';
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

export default async function InventoryAdjustmentsPage() {
  const headerStore = await headers();
  const requestId = resolveInventoryAdjustmentRequestId(headerStore.get('x-request-id'));
  let adjustments: InventoryAdjustment[] = [];
  let reasons: AdjustmentReason[] = [];
  let balances: InventoryBalance[] = [];
  let warehouses: Warehouse[] = [];
  let locations: WarehouseLocation[] = [];
  let initialError: string | null = null;
  try {
    const [adjustmentData, reasonData, inventory, organization] = await Promise.all([
      listInventoryAdjustments<InventoryAdjustment[]>(requestId),
      listInventoryAdjustmentReasons<AdjustmentReason[]>(requestId),
      loadInventorySnapshot(),
      loadOrganizationSnapshot(),
    ]);
    adjustments = adjustmentData;
    reasons = reasonData;
    balances = inventory.balances;
    warehouses = organization.warehouses.filter((item) => item.is_active);
    locations = organization.locations.filter((item) => item.is_active);
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu xử lý tồn kho';
  }
  return <InventoryAdjustmentWorkspace initialAdjustments={adjustments} reasons={reasons} balances={balances}
    warehouses={warehouses} locations={locations} initialError={initialError} />;
}
