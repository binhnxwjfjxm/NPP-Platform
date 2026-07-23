import { restRows } from "@/lib/export/supabase-rest";

type Row = Record<string, unknown>;
type RestOptions = { select?: string; order?: string; limit?: number; filters?: Record<string, string | number | boolean | null | undefined> };
export type CountItem = { label: string; count: number };
export type SessionReportSummary = {
  session: { id: string; routeId: string; routeName: string; sessionDate: string; sales: string; status: string; updatedAt: string };
  kpis: Array<{ label: string; value: string | number; hint: string }>;
  sections: {
    overview: { planned: number; visited: number; pending: number; skipped: number; observations: number; orders: number; tests: number; followups: number };
    competitors: CountItem[];
    usedProducts: CountItem[];
    opportunities: string[];
    risks: string[];
    nextActions: string[];
    observations: Array<{ id: string; customerName: string; competitors: string[]; usedProducts: string[]; note: string }>;
    orders: Array<{ id: string; code: string; customerName: string; status: string; total: number; note: string }>;
    tests: Array<{ id: string; customerName: string; productName: string; status: string; note: string }>;
    followups: Array<{ id: string; customerName: string; title: string; dueDate: string; status: string; priority: string; note: string }>;
    skipped: Array<{ id: string; customerName: string; reason: string }>;
  };
};

function text(value: unknown) { return String(value ?? "").trim(); }
function num(value: unknown) { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; }
function uniq(values: string[]) { return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))); }
function inFilter(values: string[]) { const ids = uniq(values); return ids.length ? `in.(${ids.join(",")})` : null; }
function raw(row: Row) { return row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload as Record<string, unknown> : {}; }
function rawText(row: Row, ...keys: string[]) { const data = raw(row); for (const key of keys) { const value = text(data[key]); if (value) return value; } return ""; }
function rawContextText(row: Row, ...keys: string[]) { const context = raw(row).context; if (!context || typeof context !== "object") return ""; for (const key of keys) { const value = text((context as Row)[key]); if (value) return value; } return ""; }
function selectedLabels(row: Row, key: "competitors" | "usedProducts") {
  const selected = raw(row).selected;
  if (!selected || typeof selected !== "object") return [] as string[];
  const items = (selected as Record<string, unknown>)[key];
  if (!Array.isArray(items)) return [] as string[];
  return items.map((item) => {
    if (!item || typeof item !== "object") return text(item);
    const data = item as Record<string, unknown>;
    return text(data.label || data.value || data.brandName || data.id);
  }).filter(Boolean);
}
function split(value: unknown) { return text(value).split(/[\n,;•]+/).map((item) => item.replace(/^[-–—\s]+/, "").trim()).filter(Boolean); }
function count(values: string[]): CountItem[] {
  const map = values.reduce<Record<string, number>>((acc, value) => { if (value) acc[value] = (acc[value] || 0) + 1; return acc; }, {});
  return Object.entries(map).map(([label, total]) => ({ label, count: total })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "vi"));
}
function byId(rows: Row[], key: string) {
  return rows.reduce<Record<string, Row>>((acc, row) => { const id = text(row[key]); if (id) acc[id] = row; return acc; }, {});
}
function mergeRows(groups: Row[][]) {
  const map = new Map<string, Row>();
  groups.flat().forEach((row) => { const id = text(row.id); if (id && !map.has(id)) map.set(id, row); });
  return Array.from(map.values());
}
async function restRowsSafe(table: string, options: RestOptions) {
  return restRows<Row>(table, options);
}
async function rowsByFilters(table: string, select: string, order: string, filters: Array<Record<string, string | null>>) {
  const valid = filters.filter((filter) => Object.values(filter).some((value) => text(value)));
  if (!valid.length) return [] as Row[];
  const groups = await Promise.all(valid.map((filter) => restRowsSafe(table, { select, order, limit: 20000, filters: filter })));
  return mergeRows(groups);
}
function customerFromMaps(row: Row, maps: { bySessionCustomerId: Record<string, Row>; byRouteCustomerId: Record<string, Row>; byCustomerId: Record<string, Row> }) {
  const sessionCustomerId = rawText(row, "session_customer_id", "sessionCustomerId", "resolvedSessionCustomerId");
  if (sessionCustomerId && maps.bySessionCustomerId[sessionCustomerId]) return maps.bySessionCustomerId[sessionCustomerId];
  const routeCustomerId = rawText(row, "route_customer_id", "routeCustomerId");
  if (routeCustomerId && maps.byRouteCustomerId[routeCustomerId]) return maps.byRouteCustomerId[routeCustomerId];
  const customerId = rawText(row, "customer_id", "customerId") || text(row.customer_id);
  if (customerId && maps.byCustomerId[customerId]) return maps.byCustomerId[customerId];
  return {} as Row;
}

function summaryText(summary: SessionReportSummary) {
  const overview = summary.sections.overview;
  const competitors = summary.sections.competitors.slice(0, 5).map((item) => `${item.label} (${item.count})`).join(", ");
  const usedProducts = summary.sections.usedProducts.slice(0, 5).map((item) => `${item.label} (${item.count})`).join(", ");
  return [
    `BC phiên ${summary.session.routeName} - ${summary.session.sessionDate}`,
    `Khách: ${overview.visited}/${overview.planned} đã ghé, ${overview.skipped} bỏ qua`,
    `Đơn/Test/Quan sát/Follow-up: ${overview.orders}/${overview.tests}/${overview.observations}/${overview.followups}`,
    competitors ? `Đối thủ: ${competitors}` : "",
    usedProducts ? `SP đang dùng: ${usedProducts}` : "",
    summary.sections.opportunities.length ? `Cơ hội: ${summary.sections.opportunities.join("; ")}` : "",
    summary.sections.risks.length ? `Rủi ro: ${summary.sections.risks.join("; ")}` : "",
    summary.sections.nextActions.length ? `Next action: ${summary.sections.nextActions.join("; ")}` : ""
  ].filter(Boolean).join("\n");
}

export async function buildMcpSessionReportSummary(input: { sessionId?: string; routeId?: string; date?: string }): Promise<SessionReportSummary> {
  const sessionIdInput = text(input.sessionId);
  const routeId = text(input.routeId);
  const sessionDate = text(input.date).slice(0, 10);
  if (!sessionIdInput && (!routeId || !sessionDate)) throw new Error("session_id_or_route_date_required");
  const sessions = await restRows<Row>("mcp_route_sessions", { select: "id,route_id,route_name,session_date,sales,status,planned_customers,visited_customers,order_count,test_count,report_count,followup_count,updated_at", order: "session_date.desc,updated_at.desc", limit: 1, filters: sessionIdInput ? { id: sessionIdInput } : { route_id: routeId, session_date: sessionDate } });
  const session = sessions[0];
  if (!session?.id) throw new Error("session_not_found");
  const sessionId = text(session.id);
  const customers = await restRows<Row>("mcp_session_customers", { select: "id,session_id,route_id,route_customer_id,customer_id,customer_name,phone,area,sort_order,visit_status,status_reason,order_id,test_id,report_id,followup_count,note,created_at,updated_at", order: "sort_order.asc,customer_name.asc", limit: 20000, filters: { session_id: sessionId } });
  const sessionCustomerIds = customers.map((item) => text(item.id)).filter(Boolean);
  const reportIds = customers.map((item) => text(item.report_id)).filter(Boolean);
  const orderIds = customers.map((item) => text(item.order_id)).filter(Boolean);
  const testIds = customers.map((item) => text(item.test_id)).filter(Boolean);
  const sessionCustomerIn = inFilter(sessionCustomerIds);
  const [reports, orders, tests, followupRows] = await Promise.all([
    rowsByFilters("market_reports", "id,report_date,sales,market_area,route_name,market_type,competitor_summary,price_summary,demand_summary,company_product_summary,opportunity_summary,risk_summary,next_action,note,raw_payload,created_at,updated_at", "created_at.asc", [
      { id: inFilter(reportIds) },
      { "raw_payload->>session_id": sessionId },
      { "raw_payload->>sessionId": sessionId },
      { "raw_payload->>mcp_session_id": sessionId },
      { "raw_payload->>session_customer_id": sessionCustomerIn },
      { "raw_payload->>sessionCustomerId": sessionCustomerIn },
      { "raw_payload->>resolvedSessionCustomerId": sessionCustomerIn }
    ]),
    rowsByFilters("orders", "id,order_code,order_date,customer_id,customer_name,status,grand_total,note,raw_payload,created_at,updated_at", "created_at.asc", [
      { id: inFilter(orderIds) },
      { "raw_payload->>session_id": sessionId },
      { "raw_payload->>sessionId": sessionId },
      { "raw_payload->>mcp_session_id": sessionId },
      { "raw_payload->>session_customer_id": sessionCustomerIn },
      { "raw_payload->>sessionCustomerId": sessionCustomerIn }
    ]),
    rowsByFilters("test_customer_results", "id,file_id,customer_id,product_id,product_name,status,note,raw_payload,created_at,updated_at", "created_at.asc", [
      { id: inFilter(testIds) },
      { "raw_payload->>session_id": sessionId },
      { "raw_payload->>sessionId": sessionId },
      { "raw_payload->>mcp_session_id": sessionId },
      { "raw_payload->>session_customer_id": sessionCustomerIn },
      { "raw_payload->>sessionCustomerId": sessionCustomerIn },
      { "raw_payload->>resolvedSessionCustomerId": sessionCustomerIn }
    ]),
    rowsByFilters("mcp_followups", "id,session_id,session_customer_id,route_id,route_customer_id,customer_id,customer_name,followup_type,title,due_date,status,priority,owner,note,raw_payload,created_at,updated_at", "created_at.asc", [
      { session_id: sessionId },
      { session_customer_id: sessionCustomerIn },
      { "raw_payload->>session_id": sessionId },
      { "raw_payload->>sessionCustomerId": sessionCustomerIn },
      { "raw_payload->>session_customer_id": sessionCustomerIn }
    ])
  ]);
  const maps = {
    bySessionCustomerId: byId(customers, "id"),
    byRouteCustomerId: byId(customers, "route_customer_id"),
    byCustomerId: byId(customers, "customer_id")
  };
  const customersByReportId = byId(customers, "report_id");
  const customersByOrderId = byId(customers, "order_id");
  const customersByTestId = byId(customers, "test_id");
  const visited = customers.filter((item) => text(item.visit_status) === "visited").length;
  const skipped = customers.filter((item) => text(item.visit_status) === "skipped").length;
  const pending = customers.length - visited - skipped;
  const followups = followupRows.length || customers.reduce((sum, item) => sum + num(item.followup_count), 0);
  const observations = reports.map((report) => {
    const customer = customersByReportId[text(report.id)] || customerFromMaps(report, maps);
    const customerName = text(customer.customer_name) || rawContextText(report, "customerName", "customer_name") || rawText(report, "customerName", "customer_name") || "Khách trong phiên";
    return { id: text(report.id), customerName, competitors: selectedLabels(report, "competitors"), usedProducts: selectedLabels(report, "usedProducts"), note: [text(report.competitor_summary), text(report.company_product_summary), text(report.price_summary), text(report.demand_summary), text(report.opportunity_summary), text(report.risk_summary), text(report.next_action), text(report.note)].filter(Boolean).join("\n") };
  });
  const orderItems = orders.map((order) => {
    const customer = customersByOrderId[text(order.id)] || customerFromMaps(order, maps);
    return { id: text(order.id), code: text(order.order_code) || text(order.id), customerName: text(customer.customer_name || order.customer_name) || "Khách trong phiên", status: text(order.status), total: num(order.grand_total), note: text(order.note) };
  });
  const testItems = tests.map((test) => {
    const customer = customersByTestId[text(test.id)] || customerFromMaps(test, maps);
    return { id: text(test.id), customerName: text(customer.customer_name) || "Khách trong phiên", productName: text(test.product_name), status: text(test.status), note: text(test.note) };
  });
  const followupItems = followupRows.map((row) => {
    const customer = maps.bySessionCustomerId[text(row.session_customer_id)] || customerFromMaps(row, maps);
    return { id: text(row.id), customerName: text(row.customer_name || customer.customer_name) || "Khách trong phiên", title: text(row.title) || "Follow-up khách", dueDate: text(row.due_date).slice(0, 10), status: text(row.status) || "open", priority: text(row.priority) || "medium", note: text(row.note) };
  });
  return {
    session: { id: sessionId, routeId: text(session.route_id), routeName: text(session.route_name), sessionDate: text(session.session_date).slice(0, 10), sales: text(session.sales), status: text(session.status), updatedAt: text(session.updated_at) },
    kpis: [
      { label: "Khách", value: customers.length, hint: `${visited} đã ghé · ${pending} chờ` },
      { label: "Quan sát", value: observations.length, hint: "Input cho BC phiên" },
      { label: "Đơn/Test", value: `${orderItems.length}/${testItems.length}`, hint: "Trong phiên" },
      { label: "Follow-up", value: followups, hint: `${skipped} bỏ qua` }
    ],
    sections: {
      overview: { planned: num(session.planned_customers) || customers.length, visited, pending, skipped, observations: observations.length, orders: orderItems.length, tests: testItems.length, followups },
      competitors: count([...reports.flatMap((row) => selectedLabels(row, "competitors")), ...reports.flatMap((row) => split(row.competitor_summary))]),
      usedProducts: count([...reports.flatMap((row) => selectedLabels(row, "usedProducts")), ...reports.flatMap((row) => split(row.company_product_summary))]),
      opportunities: uniq(reports.flatMap((row) => split(row.opportunity_summary))),
      risks: uniq(reports.flatMap((row) => split(row.risk_summary))),
      nextActions: uniq([...reports.flatMap((row) => split(row.next_action)), ...followupItems.map((item) => [item.title, item.dueDate].filter(Boolean).join(" · "))]),
      observations,
      orders: orderItems,
      tests: testItems,
      followups: followupItems,
      skipped: customers.filter((item) => text(item.visit_status) === "skipped").map((item) => ({ id: text(item.id), customerName: text(item.customer_name), reason: text(item.status_reason) || text(item.note) }))
    }
  };
}

export function sessionReportSummaryText(summary: SessionReportSummary) { return summaryText(summary); }
