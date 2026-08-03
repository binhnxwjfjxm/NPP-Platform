import { idempotentMutationFetch } from "@/lib/api/idempotent-fetch";

export type CoreSalesOrderStatus = "draft" | "confirmed" | "cancelled" | "closed";

export type CoreSalesOrderProjection = {
  orderId: string;
  orderCode?: string | null;
  sourceOutletId?: string | null;
  coreSalesOrderId?: string | null;
  number?: string | null;
  status?: CoreSalesOrderStatus | null;
  currentVersionNumber?: number | null;
  total?: string | null;
  currency?: string | null;
  submittedAt?: string | null;
  lastSyncedAt?: string | null;
};

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as { error?: string | { message?: string }; detail?: string; message?: string };
  if (typeof value.error === "string" && value.error.trim()) return value.error;
  if (value.error && typeof value.error === "object" && value.error.message?.trim()) return value.error.message;
  return value.detail || value.message || fallback;
}

export function coreSalesOrderFromPayload(payload: unknown): CoreSalesOrderProjection {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  if (!data || typeof data !== "object") throw new Error("Core trả về trạng thái đơn bán hàng không hợp lệ");
  const value = data as Partial<CoreSalesOrderProjection>;
  if (!value.orderId) throw new Error("Thiếu mã nhu cầu mua");
  return { ...value, orderId: value.orderId };
}

export function coreSalesOrderStatusLabel(status?: CoreSalesOrderStatus | null) {
  if (!status) return "Chưa tạo đơn chính thức";
  if (status === "draft") return "Đã tạo đơn nháp trong NPP";
  if (status === "confirmed") return "Đơn NPP đã xác nhận";
  if (status === "cancelled") return "Đơn NPP đã hủy";
  return "Đơn NPP đã hoàn tất";
}

export async function getCoreSalesOrderProjection(sessionCustomerId: string, orderId: string) {
  const params = new URLSearchParams({ sessionCustomerId, orderId });
  const response = await fetch(`/api/backend/mcp-day/session-customer/sales-order?${params.toString()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, "Không tải được trạng thái đơn NPP"));
  return coreSalesOrderFromPayload(payload);
}

async function mutate(path: string, operation: string, sessionCustomerId: string, orderId: string) {
  const response = await idempotentMutationFetch(path, {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ sessionCustomerId, orderId })
  }, { operation });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(payload, "Không xử lý được đơn NPP"));
  return coreSalesOrderFromPayload(payload);
}

export function submitCoreSalesOrder(sessionCustomerId: string, orderId: string) {
  return mutate(
    "/api/backend/mcp-day/session-customer/sales-order/submit",
    "session-customer.sales-order.submit",
    sessionCustomerId,
    orderId
  );
}

export function syncCoreSalesOrder(sessionCustomerId: string, orderId: string) {
  return mutate(
    "/api/backend/mcp-day/session-customer/sales-order/sync",
    "session-customer.sales-order.sync",
    sessionCustomerId,
    orderId
  );
}
