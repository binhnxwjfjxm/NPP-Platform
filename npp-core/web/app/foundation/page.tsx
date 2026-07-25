import { notFound } from 'next/navigation';
import FoundationDashboard from './foundation-dashboard';

export const dynamic = 'force-dynamic';

export default function FoundationPage() {
  if (process.env.FOUNDATION_TEST_UI_ENABLED !== 'true') {
    notFound();
  }

  return <FoundationDashboard />;
}
