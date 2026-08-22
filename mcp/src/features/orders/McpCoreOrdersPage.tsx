import { loadOwnedCoreCustomers } from "@/lib/api/customer-onboarding-data";
import { McpCoreOrdersClient } from "./McpCoreOrdersClient";

export async function McpCoreOrdersPage() {
  try {
    const customers = (await loadOwnedCoreCustomers())
      .filter((item) => item.status === "active" && Boolean(item.customerAddressId))
      .map((item) => ({
        customerId: item.id,
        customerAddressId: item.customerAddressId!,
        customerCode: item.customerCode,
        customerName: item.name
      }));
    return <McpCoreOrdersClient customers={customers} />;
  } catch (error) {
    return (
      <McpCoreOrdersClient
        customers={[]}
        initialError={error instanceof Error ? error.message : "Không tải được khách Công Ty đủ điều kiện tạo đơn"}
      />
    );
  }
}
