import BusinessLanguageBoundary from '../components/business-language-boundary';
import PricingIdempotencyBoundary from './pricing-idempotency-boundary';
import PricingWorkspace from './pricing-workspace';

export const dynamic = 'force-dynamic';

export default function PricingPage() {
  return (
    <PricingIdempotencyBoundary>
      <BusinessLanguageBoundary scope="pricing">
        <PricingWorkspace />
      </BusinessLanguageBoundary>
    </PricingIdempotencyBoundary>
  );
}
