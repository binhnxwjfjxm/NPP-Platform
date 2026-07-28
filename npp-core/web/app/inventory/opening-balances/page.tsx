import BusinessLanguageBoundary from '../../components/business-language-boundary';
import InventoryLot3Boundary from '../inventory-lot3-boundary';
import InventoryWorkspace from '../inventory-workspace';
import OpeningFileResetBoundary from './opening-file-reset-boundary';
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
    <BusinessLanguageBoundary scope="inventory">
      <OpeningFileResetBoundary>
        <InventoryLot3Boundary scope="opening-balances">
          <InventoryWorkspace
            scope="opening-balances"
            title="Thiết lập tồn đầu kỳ"
            subtitle="Tải tệp mẫu, xem trước dữ liệu và xác nhận ghi nhận tồn đầu kỳ."
            initialSnapshot={initialData}
            initialError={initialError}
          />
        </InventoryLot3Boundary>
      </OpeningFileResetBoundary>
    </BusinessLanguageBoundary>
  );
}
