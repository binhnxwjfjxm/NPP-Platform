import { createReadonlyDbAdapter } from "@/server/db/readonly-adapter";
import { TABLES } from "@/server/domain/tables";

export type RouteRow = {
  id: string;
  route_name: string;
  weekday: number | null;
  area: string | null;
  distributor_id: string | null;
  active: boolean | null;
  note: string | null;
};

export type RouteCustomerRow = {
  id: string;
  route_id: string;
  customer_id: string | null;
  customer_name: string;
  phone: string | null;
  area: string | null;
  address: string | null;
  sort_order: number | null;
  active: boolean | null;
  google_maps_url: string | null;
};

export async function listRoutes(): Promise<RouteRow[]> {
  const db = createReadonlyDbAdapter();
  return db.list<RouteRow>(TABLES.routes, {
    orderBy: "route_name",
    ascending: true
  });
}

export async function listRouteCustomers(routeId: string): Promise<RouteCustomerRow[]> {
  const db = createReadonlyDbAdapter();
  return db.list<RouteCustomerRow>(TABLES.routeCustomers, {
    filters: { route_id: routeId, active: true },
    orderBy: "sort_order",
    ascending: true
  });
}
