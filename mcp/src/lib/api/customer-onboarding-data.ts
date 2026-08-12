import "server-only";

import type {
  CustomerOnboardingQueueItem,
  CustomerOnboardingQueueStatus,
  CustomerOnboardingStatus
} from "@/features/accounts/customer-onboarding.types";
import { backendReadRows } from "@/lib/api/backend-read";

type Row = Record<string, unknown>;

const ONBOARDING_STATUSES = new Set<CustomerOnboardingStatus>([
  "submitted",
  "under_review",
  "need_more_info",
  "approved",
  "linked_existing",
  "rejected",
  "cancelled"
]);

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function onboardingStatus(value: unknown, coreRequestId: string | null): CustomerOnboardingQueueStatus {
  const normalized = String(value ?? "").trim().toLowerCase() as CustomerOnboardingStatus;
  if (ONBOARDING_STATUSES.has(normalized)) return normalized;
  return coreRequestId ? "submitted" : "not_submitted";
}

export async function loadCustomerOnboardingQueue(): Promise<CustomerOnboardingQueueItem[]> {
  const [orders, sessionCustomers, sessions] = await Promise.all([
    backendReadRows<Row>("orders", {
      filters: { source_type: "session_customer" },
      order: "updated_at.desc",
      limit: 500
    }),
    backendReadRows<Row>("mcp_session_customers", {
      order: "updated_at.desc",
      limit: 2000
    }),
    backendReadRows<Row>("mcp_route_sessions", {
      order: "session_date.desc,updated_at.desc",
      limit: 1000
    })
  ]);

  const sessionCustomerById = new Map<string, Row>();
  for (const row of sessionCustomers) {
    const id = text(row.id);
    if (id) sessionCustomerById.set(id, row);
  }
  const sessionById = new Map<string, Row>();
  for (const row of sessions) {
    const id = text(row.id);
    if (id) sessionById.set(id, row);
  }

  return orders.flatMap((order) => {
    const orderId = text(order.id);
    const sessionCustomerId = text(order.source_id);
    if (!orderId || !sessionCustomerId) return [];

    const sessionCustomer = sessionCustomerById.get(sessionCustomerId);
    const sessionId = text(sessionCustomer?.session_id);
    const session = sessionId ? sessionById.get(sessionId) : undefined;
    const coreRequestId = text(order.customer_onboarding_request_id);

    return [{
      orderId,
      orderCode: text(order.order_code),
      sessionCustomerId,
      sessionId,
      routeId: text(sessionCustomer?.route_id) || text(session?.route_id),
      routeName: text(session?.route_name),
      sessionDate: text(session?.session_date)?.slice(0, 10) || null,
      customerName: text(sessionCustomer?.customer_name) || text(order.customer_name) || "Khách chưa tên",
      phone: text(sessionCustomer?.phone) || text(order.customer_phone),
      area: text(sessionCustomer?.area) || text(order.area),
      address: text(sessionCustomer?.address) || text(order.delivery_address),
      status: onboardingStatus(order.customer_onboarding_status, coreRequestId),
      coreRequestId,
      coreCustomerId: text(order.core_customer_id),
      coreCustomerAddressId: text(order.core_customer_address_id),
      reviewReason: text(order.customer_onboarding_review_reason),
      submittedAt: text(order.customer_onboarding_submitted_at),
      lastSyncedAt: text(order.customer_onboarding_last_synced_at),
      updatedAt: text(order.updated_at)
    } satisfies CustomerOnboardingQueueItem];
  });
}
