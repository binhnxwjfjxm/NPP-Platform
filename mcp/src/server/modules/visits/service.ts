import { createReadonlyDbAdapter } from "@/server/db/readonly-adapter";
import { TABLES } from "@/server/domain/tables";

export type RouteSessionRow = {
  id: string;
  route_id: string;
  route_name: string | null;
  session_date: string;
  weekday: number | null;
  sales: string | null;
  area: string | null;
  status: string | null;
  planned_customers: number | null;
  visited_customers: number | null;
  order_count: number | null;
  test_count: number | null;
  report_count: number | null;
};

export type VisitRow = {
  id: string;
  session_id: string | null;
  route_id: string | null;
  route_customer_id: string | null;
  visit_date: string | null;
  status: string | null;
  has_order: boolean | null;
  has_test: boolean | null;
  has_report: boolean | null;
  order_id: string | null;
  test_id: string | null;
  report_id: string | null;
  checkin_at: string | null;
  note: string | null;
};

export async function listRouteSessions(): Promise<RouteSessionRow[]> {
  const db = createReadonlyDbAdapter();
  return db.list<RouteSessionRow>(TABLES.routeSessions, {
    orderBy: "session_date",
    ascending: false,
    limit: 100
  });
}

export async function listVisits(): Promise<VisitRow[]> {
  const db = createReadonlyDbAdapter();
  return db.list<VisitRow>(TABLES.visits, {
    orderBy: "visit_date",
    ascending: false,
    limit: 200
  });
}
