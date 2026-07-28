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
      title="Tồn kho"
      subtitle="Bảng tồn kho, lô và nhập tồn đầu kỳ bám trực tiếp dữ liệu thật của Core API."
      initialSnapshot={initialData}
      initialError={initialError}
    />
  );
}
