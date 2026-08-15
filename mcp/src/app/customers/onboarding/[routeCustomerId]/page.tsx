import { notFound } from "next/navigation";
import { CustomerOnboardingClientPage } from "@/features/accounts/CustomerOnboardingClientPage";
import { loadCustomerOnboardingQueue } from "@/lib/api/customer-onboarding-data";

export default async function Page({ params }: { params: Promise<{ routeCustomerId: string }> }) {
  const { routeCustomerId } = await params;
  const items = await loadCustomerOnboardingQueue();
  const item = items.find((candidate) => candidate.routeCustomerId === routeCustomerId);
  if (!item) notFound();
  return <CustomerOnboardingClientPage items={[item]} />;
}
