import OpeningBalanceCsvWorkspace from './opening-balance-csv-workspace';
import { createEmptyInventorySnapshot } from '../../../lib/inventory-types';
import { loadInventoryOpeningBalanceSnapshot } from '../../../lib/inventory-scoped-snapshot';

export const dynamic = 'force-dynamic';

export default async function InventoryOpeningBalancesPage() {
  let initialData = createEmptyInventorySnapshot();
  let initialError: string | null = null;

  try {
    initialData = await loadInventoryOpeningBalanceSnapshot();
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được lịch sử nhập tồn đầu kỳ.';
  }

  return <OpeningBalanceCsvWorkspace initialImports={initialData.openingBalances} initialError={initialError} />;
}
