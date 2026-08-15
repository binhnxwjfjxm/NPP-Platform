import { loadCustomerOnboardingQueue } from "@/lib/api/customer-onboarding-data";
import { McpCoreOrdersClient } from "./McpCoreOrdersClient";

export async function McpCoreOrdersPage() {
  try {
    const queue = await loadCustomerOnboardingQueue();
    const linkedCustomers = queue.filter((item) => (
      (item.status === "approved" || item.status === "linked_existing")
      && Boolean(item.coreCustomerId)
      && Boolean(item.coreCustomerAddressId)
    ));
    return <McpCoreOrdersClient linkedCustomers={linkedCustomers} />;
  } catch (error) {
    return (
      <McpCoreOrdersClient
        linkedCustomers={[]}
        initialError={error instanceof Error ? error.message : "Không tải được khách đã liên kết Core"}
      />
    );
  }
}
