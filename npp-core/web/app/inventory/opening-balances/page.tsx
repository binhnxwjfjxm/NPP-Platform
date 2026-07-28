import BusinessLanguageBoundary from '../../components/business-language-boundary';
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
    <BusinessLanguageBoundary scope="inventory">
      <InventoryWorkspace
        scope="opening-balances"
        title="Thiết lập tồn đầu kỳ"
        subtitle="Dùng một lần khi bắt đầu sử dụng hệ thống hoặc chuyển dữ liệu cũ; dữ liệu được kiểm tra trước khi ghi nhận."
        initialSnapshot={initialData}
        initialError={initialError}
      />
    </BusinessLanguageBoundary>
  );
}
