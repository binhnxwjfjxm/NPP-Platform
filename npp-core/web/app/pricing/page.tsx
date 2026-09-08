import PricingBulkOverlay from './pricing-bulk-overlay';
import PricingIdempotencyBoundary from './pricing-idempotency-boundary';
import PricingOverview from './pricing-overview';
import PricingWorkspace, { type PricingWorkspaceTab } from './pricing-workspace';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const WORKSPACE_TABS = new Set<PricingWorkspaceTab>(['channels', 'lists', 'items', 'resolver']);

function pick(search: Search | undefined, key: string) {
  const value = search?.[key];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function PricingPage({ searchParams }: { searchParams?: Search }) {
  const showOverview = pick(searchParams, 'view') === 'all';
  const requestedTab = pick(searchParams, 'tab') as PricingWorkspaceTab;
  const initialTab: PricingWorkspaceTab = WORKSPACE_TABS.has(requestedTab) ? requestedTab : 'channels';

  return (
    <PricingIdempotencyBoundary>
      {showOverview ? <PricingOverview /> : <><PricingWorkspace initialTab={initialTab} /><PricingBulkOverlay /></>}
    </PricingIdempotencyBoundary>
  );
}
