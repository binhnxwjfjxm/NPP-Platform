import { loadOwnedCoreCustomers } from "@/lib/api/customer-onboarding-data";
import { McpCoreOrdersClient } from "./McpCoreOrdersClient";

export async function McpCoreOrdersPage() {
  try {
    const customers = (await loadOwnedCoreCustomers()).filter((customer) => (
      customer.status === "active" && Boolean(customer.defaultAddressId)
    ));
    return <McpCoreOrdersClient customers={customers} />;
  } catch (error) {
    return (
      <McpCoreOrdersClient
        customers={[]}
        initialError={error instanceof Error ? error.message : "Không tải được khách Công Ty"}
      />
    );
  }
}
