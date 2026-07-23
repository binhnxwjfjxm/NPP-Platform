import { restRows } from "@/lib/export/supabase-rest";
import type { SessionReportSummary } from "@/lib/mcp/session-report";

type Row = Record<string, unknown>;

type OrderItem = SessionReportSummary["sections"]["orders"][number];
type TestItem = SessionReportSummary["sections"]["tests"][number];
type ObservationItem = SessionReportSummary["sections"]["observations"][number];
type FollowupItem = SessionReportSummary["sections"]["followups"][number];

export type SessionReportCustomerDetail = {
  id: string;
  routeId: string;
  routeCustomerId: string;
  customerId: string;
  customerName: string;
  phone: string;
  area: string;
  sortOrder: number;
  visitStatus: string;
  statusReason: string;
  note: string;
  orderId: string;
  testId: string;
  reportId: string;
  followupCount: number;
  orders: OrderItem[];
  tests: TestItem[];
  observations: ObservationItem[];
  followups: FollowupItem[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function num(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedName(value: unknown) {
  return text(value).toLocaleLowerCase("vi");
}

function byName<T extends { customerName: string }>(items: T[], customerName: string) {
  const name = normalizedName(customerName);
  return items.filter((item) => normalizedName(item.customerName) === name);
}

function linkedOrUniqueName<T extends { id: string; customerName: string }>(items: T[], linkedId: string, customerName: string, uniqueName: boolean) {
  const linked = linkedId ? items.filter((item) => text(item.id) === linkedId) : [];
  if (linked.length) return linked;
  return uniqueName ? byName(items, customerName) : [];
}

export async function buildSessionReportCustomerDetails(summary: SessionReportSummary): Promise<SessionReportCustomerDetail[]> {
  const [rows, followupLinks] = await Promise.all([
    restRows<Row>("mcp_session_customers", {
      select: "id,session_id,route_id,route_customer_id,customer_id,customer_name,phone,area,sort_order,visit_status,status_reason,order_id,test_id,report_id,followup_count,note,created_at,updated_at",
      order: "sort_order.asc,customer_name.asc",
      limit: 20000,
      filters: { session_id: summary.session.id }
    }),
    restRows<Row>("mcp_followups", {
      select: "id,session_customer_id,customer_name",
      order: "created_at.asc",
      limit: 20000,
      filters: { session_id: summary.session.id }
    })
  ]);

  const nameCounts = rows.reduce<Record<string, number>>((acc, row) => {
    const key = normalizedName(row.customer_name);
    if (key) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const followupCustomerById = followupLinks.reduce<Record<string, string>>((acc, row) => {
    const id = text(row.id);
    const sessionCustomerId = text(row.session_customer_id);
    if (id && sessionCustomerId) acc[id] = sessionCustomerId;
    return acc;
  }, {});

  return rows.map((row) => {
    const id = text(row.id);
    const customerName = text(row.customer_name) || "Khách trong phiên";
    const uniqueName = nameCounts[normalizedName(customerName)] === 1;
    const orderId = text(row.order_id);
    const testId = text(row.test_id);
    const reportId = text(row.report_id);
    const orders = linkedOrUniqueName(summary.sections.orders, orderId, customerName, uniqueName);
    const tests = linkedOrUniqueName(summary.sections.tests, testId, customerName, uniqueName);
    const observations = linkedOrUniqueName(summary.sections.observations, reportId, customerName, uniqueName);
    const linkedFollowups = summary.sections.followups.filter((item) => followupCustomerById[text(item.id)] === id);
    const followups = linkedFollowups.length ? linkedFollowups : (uniqueName ? byName(summary.sections.followups, customerName) : []);

    return {
      id,
      routeId: text(row.route_id),
      routeCustomerId: text(row.route_customer_id),
      customerId: text(row.customer_id),
      customerName,
      phone: text(row.phone),
      area: text(row.area),
      sortOrder: num(row.sort_order),
      visitStatus: text(row.visit_status) || "pending",
      statusReason: text(row.status_reason),
      note: text(row.note),
      orderId,
      testId,
      reportId,
      followupCount: Math.max(num(row.followup_count), followups.length),
      orders,
      tests,
      observations,
      followups
    };
  });
}
