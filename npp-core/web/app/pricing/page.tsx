import PricingIdempotencyBoundary from './pricing-idempotency-boundary';
import PricingBulkOverlay from './pricing-bulk-overlay';
import PricingWorkspace from './pricing-workspace';

export const dynamic = 'force-dynamic';

export default function PricingPage() {
  return (
    <PricingIdempotencyBoundary>
      <PricingWorkspace />
      <PricingBulkOverlay />
    </PricingIdempotencyBoundary>
  );
}
