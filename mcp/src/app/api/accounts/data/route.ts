import { errorResponse, restRows } from "@/lib/export/supabase-rest";
import type { AccountsData, AccountItem, AccountStatus, AccountTier } from "@/features/accounts/accounts.types";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

type CustomerAgg = {
  id: string;
  name: string;
  contactName: string;
  area: string;
  routeName: string;
  active: boolean;
  lastVisitDate: string;
  lastOrderDate: string;
  monthlyRevenue: number;
};

function text(value: unknown) { return String(value ?? "").trim(); }
function dateOnly(value: unknown) { const next = text(value).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(next) ? next : ""; }
function num(value: unknown) { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; }
function keyOf(row: Row) { return text(row.customer_id) || text(row.id) || text(row.customer_name).toLowerCase(); }
function routeKey(row: Row) { return text(row.route_id); }
function maxDate(a: string, b: string) { return !a ? b : !b ? a : a > b ? a : b; }
function daysSince(date: string) { if (!date) return Number.POSITIVE_INFINITY; const time = Date.parse(`${date}T00:00:00Z`); if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY; return Math.floor((Date.now() - time) / 86400000); }
function tier(revenue: number): AccountTier { if (revenue >= 5000000) return "A"; if (revenue >= 1000000) return "B"; return "C"; }
function status(item: CustomerAgg): AccountStatus {
  if (!item.active) return "inactive";
  if (!item.lastVisitDate || daysSince(item.lastVisitDate) > 14) return "need_visit";
  return "active";
}
function routeName(row: Row, routes: Record<string, string>) { return routes[routeKey(row)] || text(row.route_name) || text(row.route_id) || "Chưa gán tuyến"; }

export async function GET() {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const [routeCustomers, routes, sessionCustomers, orders] = await Promise.all([
      restRows<Row>("mcp_route_customers", { select: "id,route_id,customer_id,customer_name,phone,area,address,active,updated_at", order: "customer_name.asc", limit: 50000 }),
      restRows<Row>("mcp_routes", { select: "id,route_name,active,area", order: "route_name.asc", limit: 5000 }),
      restRows<Row>("mcp_session_customers", { select: "id,route_id,route_customer_id,customer_id,customer_name,phone,area,visit_status,updated_at,created_at", order: "updated_at.desc", limit: 50000 }),
      restRows<Row>("orders", { select: "id,order_date,customer_id,customer_name,customer_phone,area,grand_total,status,created_at", order: "order_date.desc,created_at.desc", limit: 50000 })
    ]);

    const routesById = routes.reduce<Record<string, string>>((acc, row) => {
      const id = text(row.id);
      if (id) acc[id] = text(row.route_name) || id;
      return acc;
    }, {});

    const map = new Map<string, CustomerAgg>();
    function ensure(row: Row, fallbackRouteName = "") {
      const key = keyOf(row);
      if (!key) return null;
      const existed = map.get(key);
      if (existed) return existed;
      const item: CustomerAgg = {
        id: key,
        name: text(row.customer_name) || text(row.name) || key,
        contactName: text(row.phone || row.customer_phone) || "-",
        area: text(row.area) || "Chưa rõ",
        routeName: fallbackRouteName || routeName(row, routesById),
        active: row.active === false ? false : true,
        lastVisitDate: "",
        lastOrderDate: "",
        monthlyRevenue: 0
      };
      map.set(key, item);
      return item;
    }

    routeCustomers.forEach((row) => {
      const item = ensure(row, routeName(row, routesById));
      if (!item) return;
      item.active = row.active === false ? false : item.active;
      item.contactName = item.contactName === "-" ? text(row.phone) || "-" : item.contactName;
      item.area = item.area === "Chưa rõ" ? text(row.area) || item.area : item.area;
      item.routeName = item.routeName === "Chưa gán tuyến" ? routeName(row, routesById) : item.routeName;
    });

    sessionCustomers.forEach((row) => {
      const item = ensure(row, routeName(row, routesById));
      if (!item) return;
      if (text(row.visit_status) === "visited") item.lastVisitDate = maxDate(item.lastVisitDate, dateOnly(row.updated_at || row.created_at));
      if (item.contactName === "-") item.contactName = text(row.phone) || "-";
      if (item.area === "Chưa rõ") item.area = text(row.area) || item.area;
    });

    orders.forEach((row) => {
      const item = ensure(row);
      if (!item) return;
      const orderDate = dateOnly(row.order_date || row.created_at);
      item.lastOrderDate = maxDate(item.lastOrderDate, orderDate);
      if (orderDate.startsWith(currentMonth)) item.monthlyRevenue += num(row.grand_total);
      if (item.contactName === "-") item.contactName = text(row.customer_phone) || "-";
      if (item.area === "Chưa rõ") item.area = text(row.area) || item.area;
    });

    const accounts: AccountItem[] = Array.from(map.values())
      .map((item) => ({
        id: item.id,
        name: item.name,
        contactName: item.contactName,
        area: item.area,
        routeName: item.routeName,
        tier: tier(item.monthlyRevenue),
        lastVisitDate: item.lastVisitDate || "-",
        lastOrderDate: item.lastOrderDate || "-",
        monthlyRevenue: item.monthlyRevenue,
        status: status(item)
      }))
      .sort((a, b) => b.monthlyRevenue - a.monthlyRevenue || a.name.localeCompare(b.name, "vi"));

    const active = accounts.filter((item) => item.status === "active").length;
    const needVisit = accounts.filter((item) => item.status === "need_visit").length;
    const inactive = accounts.filter((item) => item.status === "inactive").length;
    const revenue = accounts.reduce((sum, item) => sum + item.monthlyRevenue, 0);
    const data: AccountsData = {
      kpis: [
        { label: "Điểm bán", value: accounts.length, hint: "Từ tuyến + đơn + phiên" },
        { label: "Đang chăm sóc", value: active, hint: "Đã ghé gần đây" },
        { label: "Cần ghé lại", value: needVisit, hint: "Chưa ghé hoặc quá 14 ngày" },
        { label: "Doanh số", value: revenue.toLocaleString("vi-VN"), hint: `${inactive} chưa hoạt động` }
      ],
      accounts
    };

    return Response.json({ data, receivedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
