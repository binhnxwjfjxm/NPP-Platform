import BusinessLanguageBoundary from '../../components/business-language-boundary';
import InventoryWorkspace from '../inventory-workspace';
import { createEmptyInventorySnapshot } from '../../../lib/inventory-types';
import { loadInventorySnapshot } from '../../../lib/inventory-snapshot';

export const dynamic = 'force-dynamic';

export default async function InventoryTrackingPoliciesPage() {
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
        scope="tracking-policies"
        title="Chính sách quản lý lô"
        subtitle="Thiết lập cách theo dõi lô, hạn sử dụng và vị trí hàng cho từng SKU cơ sở."
        initialSnapshot={initialData}
        initialError={initialError}
      />
    </BusinessLanguageBoundary>
  );
}
