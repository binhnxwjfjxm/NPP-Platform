import InventoryWorkspace from '../inventory-workspace';
import { createEmptyInventorySnapshot } from '../../../lib/inventory-types';
import { loadInventorySnapshot } from '../../../lib/inventory-snapshot';

export const dynamic = 'force-dynamic';

export default async function InventoryOpeningBalancesPage() {
  let initialData = createEmptyInventorySnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadInventorySnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được dữ liệu tồn kho';
  }

  return (
    <InventoryWorkspace
      scope="opening-balances"
      title="Nhập tồn đầu kỳ"
      subtitle="Kiểm tra dòng JSON và ghi sổ nhập tồn đầu kỳ nguyên tử qua Core API."
      initialSnapshot={initialData}
      initialError={initialError}
    />
  );
}
