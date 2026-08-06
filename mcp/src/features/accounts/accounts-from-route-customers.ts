import type { RouteCustomersData } from "@/features/mcp/route-customers.types";
import type { AccountStatus, AccountsData } from "./accounts.types";

function toAccountStatus(status: RouteCustomersData["customers"][number]["status"]): AccountStatus {
  return status;
}

function mapsUrl(customer: RouteCustomersData["customers"][number]) {
  if (customer.gps) {
    const destination = `${customer.gps.lat},${customer.gps.lng}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  }

  const query = [customer.accountName, customer.area]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function accountsFromRouteCustomers(data: RouteCustomersData): AccountsData {
  const accounts = data.customers.map((customer) => ({
    id: customer.id,
    routeCustomerId: customer.id,
    accountId: customer.accountId || null,
    name: customer.accountName,
    contactName: customer.contactName,
    area: customer.area,
    routeName: customer.routeName,
    sortOrder: customer.sortOrder,
    status: toAccountStatus(customer.status),
    gps: customer.gps || null,
    note: customer.note,
    mapsUrl: mapsUrl(customer)
  }));

  const withGps = accounts.filter((account) => Boolean(account.gps)).length;
  const needsGps = accounts.filter((account) => account.status === "needs_gps" || !account.gps).length;
  const hidden = accounts.filter((account) => account.status === "hidden").length;

  return {
    kpis: [
      { label: "Điểm bán", value: accounts.length, hint: "Danh sách khách đang có trong các tuyến" },
      { label: "Có GPS", value: withGps, hint: "Có tọa độ để mở chỉ đường chính xác" },
      { label: "Cần GPS", value: needsGps, hint: "Chưa có tọa độ hoặc đang chờ cập nhật vị trí" },
      { label: "Đang ẩn", value: hidden, hint: "Điểm bán hiện không hiển thị trong tuyến hoạt động" }
    ],
    accounts
  };
}
