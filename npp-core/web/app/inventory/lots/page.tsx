import InventoryWorkspace from '../inventory-workspace';
import { createEmptyInventorySnapshot } from '../../../lib/inventory-types';
import { loadInventorySnapshot } from '../../../lib/inventory-snapshot';

export const dynamic = 'force-dynamic';

export default async function InventoryLotsPage() {
  let initialData = createEmptyInventorySnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadInventorySnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tồn kho';
  }

  return (
    <InventoryWorkspace
      scope="lots"
      title="Lô hàng"
      subtitle="Danh sách lô chuẩn và hạn dùng của từng SKU cơ sở."
      initialSnapshot={initialData}
      initialError={initialError}
    />
  );
}
