import { headers } from 'next/headers';
import { loadOrganizationSnapshot } from '../../../../lib/organization-snapshot';
import {
  listInventoryAdjustmentReasons,
  resolveInventoryAdjustmentRequestId,
} from '../../../../lib/inventory-adjustment-gateway';
import type { AdjustmentReason } from '../../../../lib/inventory-adjustment-types';
import type { Warehouse } from '../../../../lib/organization-types';
import BulkInventoryAdjustmentWorkspace from './bulk-workspace';

export const dynamic = 'force-dynamic';

export default async function BulkInventoryAdjustmentsPage() {
  const headerStore = await headers();
  const requestId = resolveInventoryAdjustmentRequestId(headerStore.get('x-request-id'));
  let reasons: AdjustmentReason[] = [];
  let warehouses: Warehouse[] = [];
  let initialError: string | null = null;
  try {
    const [reasonData, organization] = await Promise.all([
      listInventoryAdjustmentReasons<AdjustmentReason[]>(requestId),
      loadOrganizationSnapshot(),
    ]);
    reasons = reasonData;
    warehouses = organization.warehouses.filter((item) => item.is_active);
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu điều chỉnh tồn hàng loạt';
  }
  return <BulkInventoryAdjustmentWorkspace reasons={reasons} warehouses={warehouses} initialError={initialError} />;
}