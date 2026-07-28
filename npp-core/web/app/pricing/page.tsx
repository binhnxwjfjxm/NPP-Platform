import PricingIdempotencyBoundary from './pricing-idempotency-boundary';
import PricingWorkspace from './pricing-workspace';

export const dynamic = 'force-dynamic';

export default function PricingPage() {
  return (
    <PricingIdempotencyBoundary>
      <PricingWorkspace />
    </PricingIdempotencyBoundary>
  );
}
