import type { DashboardData } from "./dashboard.types";

export const dashboardMock: DashboardData = {
  kpis: [
    {
      label: "Doanh so hom nay",
      value: "403K",
      hint: "Mock theo don hang mau",
      trend: "+12% so voi hom qua"
    },
    {
      label: "Tuyen active",
      value: 8,
      hint: "Dang mo trong he thong",
      trend: "On dinh"
    },
    {
      label: "Diem ban",
      value: 51,
      hint: "Khach hang trong tuyen",
      trend: "+4 diem can cham soc"
    },
    {
      label: "Luot ghe",
      value: 73,
      hint: "Da ghi nhan tren route",
      trend: "72 da hoan thanh"
    }
  ],
  routeHealth: [
    {
      routeName: "Tuyen trung tam",
      area: "Cho Gao",
      planned: 18,
      visited: 17,
      orders: 2,
      status: "good"
    },
    {
      routeName: "Tuyen phia Dong",
      area: "My Tho",
      planned: 14,
      visited: 11,
      orders: 0,
      status: "watch"
    },
    {
      routeName: "Tuyen ven song",
      area: "Go Cong",
      planned: 12,
      visited: 7,
      orders: 0,
      status: "risk"
    },
    {
      routeName: "Tuyen dai ly moi",
      area: "Cai Be",
      planned: 9,
      visited: 9,
      orders: 1,
      status: "good"
    }
  ],
  actions: [
    {
      title: "Ghe lai nhom khach chua phat sinh don",
      description: "Uu tien cac diem ban da visit nhung chua co order trong 2 ngay gan nhat.",
      priority: "high",
      owner: "Sale phu trach"
    },
    {
      title: "Kiem tra lai tuyen ven song",
      description: "Ty le visit thap hon ke hoach, can xem lai lich ghe va ly do bo diem.",
      priority: "medium",
      owner: "Giam sat"
    },
    {
      title: "Chuan hoa danh sach diem ban",
      description: "Bo sung dien thoai, dia chi va toa do cho cac khach hang thieu thong tin.",
      priority: "medium",
      owner: "Admin NPP"
    }
  ],
  insights: [
    { label: "Ty le ghe tham", value: "88%" },
    { label: "Ty le co don", value: "2.7%" },
    { label: "San pham dang test", value: "33 SKU" },
    { label: "Bao cao thi truong", value: "Cho phase sau" }
  ]
};
