import PricingBulkOverlay from './pricing-bulk-overlay';
import PricingIdempotencyBoundary from './pricing-idempotency-boundary';
import PricingModeNav from './pricing-mode-nav';
import PricingOverview from './pricing-overview';
import PricingWorkspace from './pricing-workspace';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
function pick(search: Search | undefined, key: string) {
  const value = search?.[key];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function PricingPage({ searchParams }: { searchParams?: Search }) {
  const active = pick(searchParams, 'view') === 'all' ? 'all' : 'manage';
  return (
    <PricingIdempotencyBoundary>
      <PricingModeNav active={active} />
      {active === 'all' ? <PricingOverview /> : <><PricingWorkspace /><PricingBulkOverlay /></>}
    </PricingIdempotencyBoundary>
  );
}
