import type { RouteCustomersData } from "@/features/mcp/route-customers.types";
import type { AccountStatus, AccountsData } from "./accounts.types";

function toAccountStatus(status: RouteCustomersData["customers"][number]["status"]): AccountStatus {
  if (status === "hidden") return "inactive";
  if (status === "needs_gps") return "need_visit";
  return "active";
}

export function accountsFromRouteCustomers(data: RouteCustomersData): AccountsData {
  const accounts = data.customers.map((customer) => ({
    id: customer.accountId || customer.id,
    name: customer.accountName,
    contactName: customer.contactName,
    area: customer.area,
    routeName: customer.routeName,
    tier: "-" as const,
    lastVisitDate: "-",
    lastOrderDate: "-",
    monthlyRevenue: 0,
    status: toAccountStatus(customer.status)
  }));

  const active = accounts.filter((account) => account.status === "active").length;
  const needVisit = accounts.filter((account) => account.status === "need_visit").length;
  const inactive = accounts.filter((account) => account.status === "inactive").length;

  return {
    kpis: [
      { label: "Điểm bán", value: accounts.length, hint: "Từ danh sách khách trong tuyến" },
      { label: "Đang chăm sóc", value: active, hint: "Đang hoạt động và đã có GPS" },
      { label: "Cần ghé lại", value: needVisit, hint: "Thiếu vị trí hoặc cần cập nhật hồ sơ" },
      { label: "Chưa có dữ liệu", value: inactive, hint: "Đang ẩn khỏi tuyến" }
    ],
    accounts
  };
}
