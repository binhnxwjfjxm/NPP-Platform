export const routes = [
  { id: "route-a", route_name: "Tuyến A", area: "Quận 1", active: true },
  { id: "route-b", route_name: "Tuyến B", area: "Quận 2", active: true },
  { id: "route-c", route_name: "Tuyến chưa có phiên", area: "Quận 3", active: true }
];

// Deliberately unordered. The newer route-a rows also tie on business date.
export const sessions = [
  { id: "a-old", route_id: "route-a", session_date: "2026-07-19", updated_at: "2026-07-19T08:00:00Z", status: "done", planned_customers: 9, visited_customers: 9, order_count: 90, followup_count: 90 },
  { id: "b-cancelled", route_id: "route-b", session_date: "2026-07-21", updated_at: "2026-07-21T03:00:00Z", status: "cancelled", planned_customers: 5, visited_customers: 1, order_count: 1, followup_count: 1 },
  { id: "a-newer-tie", route_id: "route-a", session_date: "2026-07-21", updated_at: "2026-07-21T04:00:00Z", status: "completed", planned_customers: 12, visited_customers: 8, order_count: 7, followup_count: 6 },
  { id: "a-newer-old-update", route_id: "route-a", session_date: "2026-07-21", updated_at: "2026-07-21T02:00:00Z", status: "active", planned_customers: 99, visited_customers: 99, order_count: 99, followup_count: 99 }
];

export const reports = [
  { id: "report-old", session_id: "a-old", snapshot_at: "2026-07-22T00:00:00Z", overview: { planned: 100, visited: 100, orders: 100, followups: 100 } },
  {
    id: "report-new",
    session_id: "a-newer-tie",
    snapshot_at: "2026-07-21T05:00:00Z",
    overview: { planned: 12, visited: 9, orders: 50, followups: 50 },
    sections: {
      orders: [{ id: "order-1" }, { id: "order-1" }, { id: "order-2" }],
      followups: [{ id: "followup-1" }, { id: "followup-1" }, { id: "followup-2" }, { id: "followup-3" }]
    }
  }
];

export const readFailure = new Error("dashboard_fixture_read_failed");
