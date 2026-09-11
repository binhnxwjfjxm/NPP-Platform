import TrackingPolicyWorkspace from './tracking-policy-workspace';
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
    <TrackingPolicyWorkspace
      initialPolicies={initialData.trackingPolicies}
      initialCandidates={initialCandidates}
      initialError={initialError}
    />
  );
}
