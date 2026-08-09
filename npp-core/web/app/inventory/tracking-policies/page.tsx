import InventoryScopedWorkspace from '../inventory-scoped-workspace';
import { createEmptyInventorySnapshot } from '../../../lib/inventory-types';
import { loadInventoryTrackingPolicySnapshot } from '../../../lib/inventory-scoped-snapshot';
import type { InventoryTrackingPolicyCandidate } from '../../../lib/inventory-policy-types';

export const dynamic = 'force-dynamic';

export default async function InventoryTrackingPoliciesPage() {
  let initialData = createEmptyInventorySnapshot();
  let initialCandidates: InventoryTrackingPolicyCandidate[] = [];
  let initialError: string | null = null;

  try {
    const loaded = await loadInventoryTrackingPolicySnapshot();
    initialData = loaded.snapshot;
    initialCandidates = loaded.candidates;
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Không tải được chính sách quản lý lô';
  }

  return (
    <InventoryScopedWorkspace
      scope="tracking-policies"
      title="Chính sách quản lý lô"
      subtitle="Chọn cách quản lý lô, hạn sử dụng và vị trí cho từng SKU."
      initialSnapshot={initialData}
      initialCandidates={initialCandidates}
      initialError={initialError}
    />
  );
}
