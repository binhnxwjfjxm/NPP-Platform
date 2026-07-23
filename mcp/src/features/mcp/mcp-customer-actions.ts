export type McpCustomerAction = "order" | "test" | "market_report" | "follow_up" | "skip";

export function mcpCustomerActionLabel(action: McpCustomerAction) {
  if (action === "order") return "Tạo đơn";
  if (action === "test") return "Ghi test";
  if (action === "market_report") return "Quan sát";
  if (action === "skip") return "Bỏ qua / không mua";
  return "Follow-up";
}

export function mcpCustomerActionDescription(action: McpCustomerAction) {
  if (action === "order") return "Tạo đơn hàng và link vào checklist phiên.";
  if (action === "test") return "Ghi test sản phẩm trong checklist phiên.";
  if (action === "market_report") return "Ghi quan sát nhanh theo khách để BC phiên tự tổng hợp sau.";
  if (action === "skip") return "Đánh dấu bỏ qua hoặc không mua, bắt buộc có lý do.";
  return "Tạo việc theo dõi gắn với session customer snapshot.";
}

export const MCP_CUSTOMER_ACTIONS: McpCustomerAction[] = ["order", "test", "market_report", "follow_up", "skip"];
