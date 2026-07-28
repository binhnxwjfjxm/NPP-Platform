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
    <InventoryWorkspace
      scope="tracking-policies"
      title="Chính sách lô"
      subtitle="Quản trị lô, hạn dùng và yêu cầu vị trí cho từng SKU cơ sở."
      initialSnapshot={initialData}
      initialError={initialError}
    />
  );
}
