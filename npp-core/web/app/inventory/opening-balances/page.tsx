import OpeningBalanceCsvWorkspace from './opening-balance-csv-workspace';
import { createEmptyInventorySnapshot } from '../../../lib/inventory-types';
import { loadInventorySnapshot } from '../../../lib/inventory-snapshot';

export const dynamic = 'force-dynamic';

export default async function InventoryOpeningBalancesPage() {
  let initialData = createEmptyInventorySnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadInventorySnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được lịch sử nhập tồn đầu kỳ.';
  }

  return <OpeningBalanceCsvWorkspace initialImports={initialData.openingBalances} initialError={initialError} />;
}
