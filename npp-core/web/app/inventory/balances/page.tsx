import InventoryWorkspace from '../inventory-workspace';
import { createEmptyInventorySnapshot } from '../../../lib/inventory-types';
import { loadInventorySnapshot } from '../../../lib/inventory-snapshot';

export const dynamic = 'force-dynamic';

export default async function InventoryBalancesPage() {
  let initialData = createEmptyInventorySnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadInventorySnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tồn kho';
  }

  return (
    <InventoryWorkspace
      scope="balances"
      title="Tra cứu tồn kho"
      subtitle="Xem số lượng hiện tại, khả dụng, đang giữ và vị trí hàng theo dữ liệu thực tế của hệ thống."
      initialSnapshot={initialData}
      initialError={initialError}
    />
  );
}
