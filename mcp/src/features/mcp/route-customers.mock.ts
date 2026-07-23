import type { RouteCustomersData } from "./route-customers.types";

export const routeCustomersMock: RouteCustomersData = {
  kpis: [
    { label: "Khach trong tuyen", value: 6, hint: "Route Customer Master" },
    { label: "Da co GPS", value: 4, hint: "Mo duoc ban do" },
    { label: "Can GPS", value: 2, hint: "Can sale cap nhat" },
    { label: "Dang an", value: 1, hint: "Khong xoa khoi master" }
  ],
  customers: [
    {
      id: "rc-001",
      routeId: "route-cho-gao-center",
      routeName: "Tuyen Cho Gao trung tam",
      accountId: "acc-cho-gao-001",
      accountName: "Tap hoa Minh Chau",
      contactName: "Chi Chau",
      area: "Cho Gao",
      sortOrder: 1,
      status: "active",
      gps: { lat: 10.35431, lng: 106.46412, accuracyMeters: 18, updatedAt: "2026-06-30" },
      note: "Diem ban tier A, uu tien ghe dau tuyen."
    },
    {
      id: "rc-002",
      routeId: "route-cho-gao-center",
      routeName: "Tuyen Cho Gao trung tam",
      accountId: "acc-cho-gao-002",
      accountName: "Dai ly Thanh Phat",
      contactName: "Anh Phat",
      area: "Cho Gao",
      sortOrder: 2,
      status: "active",
      gps: { lat: 10.35911, lng: 106.47042, accuracyMeters: 22, updatedAt: "2026-06-30" },
      note: "Co don thuong xuyen."
    },
    {
      id: "rc-003",
      routeId: "route-my-tho-east",
      routeName: "Tuyen My Tho phia Dong",
      accountId: "acc-my-tho-001",
      accountName: "Cua hang Huong Que",
      contactName: "Chi Huong",
      area: "My Tho",
      sortOrder: 3,
      status: "needs_gps",
      note: "Can cap nhat GPS khi ghe lai."
    },
    {
      id: "rc-004",
      routeId: "route-go-cong-river",
      routeName: "Tuyen Go Cong ven song",
      accountId: "acc-go-cong-001",
      accountName: "Tap hoa Ven Song",
      contactName: "Anh Nam",
      area: "Go Cong",
      sortOrder: 4,
      status: "active",
      gps: { lat: 10.36982, lng: 106.59877, accuracyMeters: 35, updatedAt: "2026-06-25" },
      note: "Duong ven song, can mo Maps truoc khi di."
    },
    {
      id: "rc-005",
      routeId: "route-cai-be-new-agent",
      routeName: "Tuyen Cai Be dai ly moi",
      accountId: "acc-cai-be-001",
      accountName: "Dai ly Tan Loi",
      contactName: "Chi Loi",
      area: "Cai Be",
      sortOrder: 5,
      status: "active",
      gps: { lat: 10.33542, lng: 106.03252, accuracyMeters: 24, updatedAt: "2026-06-30" },
      note: "Khach moi co tiem nang."
    },
    {
      id: "rc-006",
      routeId: "route-maintenance",
      routeName: "Tuyen bao tri du lieu",
      accountId: "acc-data-001",
      accountName: "Diem ban thieu thong tin",
      contactName: "Chua cap nhat",
      area: "Tong hop",
      sortOrder: 99,
      status: "hidden",
      note: "Tam an khoi tuyen ngay, khong hard delete."
    }
  ]
};
