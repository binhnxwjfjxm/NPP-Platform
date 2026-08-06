import type { AccountsData } from "./accounts.types";

export const accountsMock: AccountsData = {
  kpis: [
    { label: "Điểm bán", value: 4, hint: "Dữ liệu phát triển từ danh sách tuyến" },
    { label: "Có GPS", value: 2, hint: "Có tọa độ để mở chỉ đường chính xác" },
    { label: "Cần GPS", value: 1, hint: "Chưa có tọa độ hoặc cần cập nhật vị trí" },
    { label: "Đang ẩn", value: 1, hint: "Không hiển thị trong tuyến hoạt động" }
  ],
  accounts: [
    {
      id: "route-customer-cho-gao-001",
      routeCustomerId: "route-customer-cho-gao-001",
      accountId: "acc-cho-gao-001",
      name: "Tạp hóa Minh Châu",
      contactName: "Chị Châu",
      area: "Chợ Gạo",
      routeName: "Tuyến Chợ Gạo trung tâm",
      sortOrder: 1,
      status: "active",
      gps: { lat: 10.3589, lng: 106.4631, accuracyMeters: 12, updatedAt: "2026-07-03T08:00:00.000Z" },
      note: "Điểm bán trong tuyến phát triển",
      mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=10.3589%2C106.4631&travelmode=driving"
    },
    {
      id: "route-customer-cho-gao-002",
      routeCustomerId: "route-customer-cho-gao-002",
      accountId: "acc-cho-gao-002",
      name: "Đại lý Thành Phát",
      contactName: "Anh Phát",
      area: "Chợ Gạo",
      routeName: "Tuyến Chợ Gạo trung tâm",
      sortOrder: 2,
      status: "active",
      gps: { lat: 10.3612, lng: 106.4674, accuracyMeters: 18, updatedAt: "2026-07-03T08:15:00.000Z" },
      note: "",
      mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=10.3612%2C106.4674&travelmode=driving"
    },
    {
      id: "route-customer-my-tho-001",
      routeCustomerId: "route-customer-my-tho-001",
      accountId: "acc-my-tho-001",
      name: "Cửa hàng Hương Quê",
      contactName: "Chị Hương",
      area: "Mỹ Tho",
      routeName: "Tuyến Mỹ Tho phía Đông",
      sortOrder: 1,
      status: "needs_gps",
      gps: null,
      note: "Cần cập nhật tọa độ",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=C%E1%BB%ADa%20h%C3%A0ng%20H%C6%B0%C6%A1ng%20Qu%C3%AA%2C%20M%E1%BB%B9%20Tho"
    },
    {
      id: "route-customer-hidden-001",
      routeCustomerId: "route-customer-hidden-001",
      accountId: null,
      name: "Điểm bán tạm ẩn",
      contactName: "Chưa cập nhật",
      area: "Gò Công",
      routeName: "Tuyến Gò Công ven sông",
      sortOrder: 3,
      status: "hidden",
      gps: null,
      note: "Đang ẩn khỏi tuyến hoạt động",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=%C4%90i%E1%BB%83m%20b%C3%A1n%20t%E1%BA%A1m%20%E1%BA%A9n%2C%20G%C3%B2%20C%C3%B4ng"
    }
  ]
};
