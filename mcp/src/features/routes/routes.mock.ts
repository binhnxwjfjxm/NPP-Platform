import type { RoutesData } from "./routes.types";

export const routesMock: RoutesData = {
  kpis: [
    { label: "Tuyen active", value: 8, hint: "Dang mo de cham soc thi truong" },
    { label: "Tong diem ban", value: 51, hint: "Mock theo audit data hien co" },
    { label: "Da ghe", value: "72/73", hint: "Ty le hoan thanh visit cao" },
    { label: "Tuyen can theo doi", value: 2, hint: "Can xem lai lich ghe va don hang" }
  ],
  routes: [
    {
      id: "route-cho-gao-center",
      name: "Tuyen Cho Gao trung tam",
      area: "Cho Gao",
      salesOwner: "Sale A",
      plannedCustomers: 18,
      visitedCustomers: 17,
      orderCount: 2,
      lastVisitDate: "2026-06-30",
      status: "active"
    },
    {
      id: "route-my-tho-east",
      name: "Tuyen My Tho phia Dong",
      area: "My Tho",
      salesOwner: "Sale B",
      plannedCustomers: 14,
      visitedCustomers: 11,
      orderCount: 0,
      lastVisitDate: "2026-06-30",
      status: "watch"
    },
    {
      id: "route-go-cong-river",
      name: "Tuyen Go Cong ven song",
      area: "Go Cong",
      salesOwner: "Sale C",
      plannedCustomers: 12,
      visitedCustomers: 7,
      orderCount: 0,
      lastVisitDate: "2026-06-29",
      status: "watch"
    },
    {
      id: "route-cai-be-new-agent",
      name: "Tuyen Cai Be dai ly moi",
      area: "Cai Be",
      salesOwner: "Sale A",
      plannedCustomers: 9,
      visitedCustomers: 9,
      orderCount: 1,
      lastVisitDate: "2026-06-30",
      status: "active"
    },
    {
      id: "route-maintenance",
      name: "Tuyen bao tri du lieu",
      area: "Tong hop",
      salesOwner: "Admin NPP",
      plannedCustomers: 0,
      visitedCustomers: 0,
      orderCount: 0,
      lastVisitDate: "-",
      status: "paused"
    }
  ]
};
