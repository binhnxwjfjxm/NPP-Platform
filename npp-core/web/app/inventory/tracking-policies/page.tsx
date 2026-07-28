import InventoryLot3Boundary from '../inventory-lot3-boundary';
import InventoryWorkspace from '../inventory-workspace';
import { createEmptyInventorySnapshot } from '../../../lib/inventory-types';
import { loadInventorySnapshot } from '../../../lib/inventory-snapshot';

export const dynamic = 'force-dynamic';

export default async function InventoryTrackingPoliciesPage() {
  let initialData = createEmptyInventorySnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadInventorySnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tồn kho';
  }

  return (
    <InventoryLot3Boundary scope="tracking-policies">
      <InventoryWorkspace
        scope="tracking-policies"
        title="Chính sách quản lý lô"
        subtitle="Chọn cách quản lý lô, hạn sử dụng và vị trí cho từng SKU theo đúng khả năng backend hiện có."
        initialSnapshot={initialData}
        initialError={initialError}
      />
    </InventoryLot3Boundary>
  );
}
