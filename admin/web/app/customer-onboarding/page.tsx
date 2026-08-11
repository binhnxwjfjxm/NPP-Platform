import { redirect } from 'next/navigation';
import { ADMIN_ROUTE_ALIASES } from '../admin-shell';

export default function LegacyCustomerOnboardingAdminRoute() {
  redirect(ADMIN_ROUTE_ALIASES['/customer-onboarding']);
}
