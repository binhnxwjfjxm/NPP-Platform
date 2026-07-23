export type McpSessionCustomerSource = "planned" | "added" | "synced";

export type McpSessionCustomerStatus = "pending" | "visited" | "skipped" | "cancelled";

export type McpSessionStatus = "draft" | "opened" | "completed" | "cancelled";

export const MCP_SESSION_SNAPSHOT_RULES = [
  "Route Master la ke hoach goc, khong phai phien ngay.",
  "Mo phien MCP ngay phai tao Session Customer Snapshot tu Route Customer Master.",
  "Sua Route Master sau khi mo phien khong duoc tu dong sua snapshot da mo.",
  "Khach phat sinh trong ngay phai co source = added.",
  "Khong hard delete khach khoi phien; dung skipped/cancelled kem ly do.",
  "mcp_visits chi luu ket qua ghe thuc te, khong phai danh sach khach phai ghe."
] as const;

export type McpSessionCustomerSnapshot = {
  id: string;
  sessionId: string;
  routeCustomerId?: string;
  accountId: string;
  accountName: string;
  sortOrder: number;
  source: McpSessionCustomerSource;
  status: McpSessionCustomerStatus;
  skipReason?: string;
  cancelReason?: string;
};

export type McpVisitResult = {
  id: string;
  sessionCustomerId: string;
  startedAt?: string;
  endedAt?: string;
  result: string;
  hasOrder: boolean;
  nextAction?: string;
};

export function requiresReason(status: McpSessionCustomerStatus) {
  return status === "skipped" || status === "cancelled";
}
