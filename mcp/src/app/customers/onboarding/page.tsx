import { CustomerOnboardingClientPage } from "@/features/accounts/CustomerOnboardingClientPage";
import { loadCustomerOnboardingQueue } from "@/lib/api/customer-onboarding-data";

export default async function Page() {
  const items = await loadCustomerOnboardingQueue();
  return <CustomerOnboardingClientPage items={items} />;
}
