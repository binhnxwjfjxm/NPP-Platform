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
      subtitle="Theo dõi mã lô, ngày sản xuất, hạn sử dụng và thông tin liên quan của từng SKU."
      initialSnapshot={initialData}
      initialError={initialError}
    />
  );
}
