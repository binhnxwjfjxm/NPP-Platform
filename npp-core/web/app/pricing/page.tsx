import BusinessLanguageBoundary from '../components/business-language-boundary';
import PricingWorkspace from './pricing-workspace';

export const dynamic = 'force-dynamic';

export default function PricingPage() {
  return (
    <BusinessLanguageBoundary scope="pricing">
      <PricingWorkspace />
    </BusinessLanguageBoundary>
  );
}
