import InventoryScopedWorkspace from '../inventory-scoped-workspace';
import { createEmptyInventorySnapshot } from '../../../lib/inventory-types';
import { loadInventoryLotsSnapshot } from '../../../lib/inventory-scoped-snapshot';

export const dynamic = 'force-dynamic';

export default async function InventoryLotsPage() {
  let initialData = createEmptyInventorySnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadInventoryLotsSnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu lô hàng';
  }

  return (
    <InventoryScopedWorkspace
      scope="lots"
      title="Lô hàng"
      subtitle="Theo dõi mã lô, ngày sản xuất, hạn sử dụng và thông tin liên quan của từng SKU."
      initialSnapshot={initialData}
      initialError={initialError}
    />
  );
}
