import { createReadonlyDbAdapter } from "@/server/db/readonly-adapter";
import { TABLES } from "@/server/domain/tables";

export type DashboardSummary = {
  routes: { active: number };
  customers: { active: number };
  sessions: { total: number; active: number };
  visits: { total: number; visited: number };
  tests: { files: number; customers: number; products: number; results: number };
  orders: { count: number };
  marketReports: { count: number };
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const db = createReadonlyDbAdapter();

  const [
    activeRoutes,
    activeRouteCustomers,
    totalSessions,
    activeSessions,
    totalVisits,
    visitedVisits,
    testFiles,
    testCustomers,
    testProducts,
    testResults,
    orders,
    marketReports
  ] = await Promise.all([
    db.count(TABLES.routes, { active: true }),
    db.count(TABLES.routeCustomers, { active: true }),
    db.count(TABLES.routeSessions),
    db.count(TABLES.routeSessions, { status: "active" }),
    db.count(TABLES.visits),
    db.count(TABLES.visits, { status: "visited" }),
    db.count(TABLES.testFiles, { status: "active" }),
    db.count(TABLES.testCustomers),
    db.count(TABLES.testFileProducts, { status: "active" }),
    db.count(TABLES.testCustomerResults),
    db.count(TABLES.orders),
    db.count(TABLES.marketReports)
  ]);

  return {
    routes: { active: activeRoutes },
    customers: { active: activeRouteCustomers },
    sessions: { total: totalSessions, active: activeSessions },
    visits: { total: totalVisits, visited: visitedVisits },
    tests: { files: testFiles, customers: testCustomers, products: testProducts, results: testResults },
    orders: { count: orders },
    marketReports: { count: marketReports }
  };
}
