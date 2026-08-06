import type { AccountsData } from "./accounts.types";

export const accountsMock: AccountsData = {
  kpis: [
    { label: "Điểm bán active", value: 51, hint: "Đang nằm trong các tuyến MCP" },
    { label: "Cần ghé lại", value: 9, hint: "Chưa có lượt ghé gần nhất hoặc chưa có đơn" },
    { label: "Nhóm tier A", value: 12, hint: "Điểm bán ưu tiên doanh số" },
    { label: "Doanh số mẫu", value: "18.4M", hint: "Số mẫu để thiết kế UI" }
  ],
  accounts: [
    {
      id: "acc-cho-gao-001",
      name: "Tạp hóa Minh Châu",
      contactName: "Chị Châu",
      area: "Chợ Gạo",
      routeName: "Tuyến Chợ Gạo trung tâm",
      tier: "A",
      lastVisitDate: "2026-06-30",
      lastOrderDate: "2026-06-29",
      monthlyRevenue: 5200000,
      status: "active"
    },
    {
      id: "acc-cho-gao-002",
      name: "Đại lý Thành Phát",
      contactName: "Anh Phát",
      area: "Chợ Gạo",
      routeName: "Tuyến Chợ Gạo trung tâm",
      tier: "A",
      lastVisitDate: "2026-06-30",
      lastOrderDate: "2026-06-29",
      monthlyRevenue: 7100000,
      status: "active"
    },
    {
      id: "acc-my-tho-001",
      name: "Cửa hàng Hương Quê",
      contactName: "Chị Hương",
      area: "Mỹ Tho",
      routeName: "Tuyến Mỹ Tho phía Đông",
      tier: "B",
      lastVisitDate: "2026-06-28",
      lastOrderDate: "-",
      monthlyRevenue: 0,
      status: "need_visit"
    },
    {
      id: "acc-go-cong-001",
      name: "Tạp hóa Ven Sông",
      contactName: "Anh Nam",
      area: "Gò Công",
      routeName: "Tuyến Gò Công ven sông",
      tier: "C",
      lastVisitDate: "2026-06-25",
      lastOrderDate: "-",
      monthlyRevenue: 0,
      status: "need_visit"
    },
    {
      id: "acc-cai-be-001",
      name: "Đại lý Tân Lợi",
      contactName: "Chị Lợi",
      area: "Cái Bè",
      routeName: "Tuyến Cái Bè đại lý mới",
      tier: "B",
      lastVisitDate: "2026-06-30",
      lastOrderDate: "2026-06-30",
      monthlyRevenue: 6100000,
      status: "active"
    },
    {
      id: "acc-data-001",
      name: "Điểm bán thiếu thông tin",
      contactName: "Chưa cập nhật",
      area: "Tổng hợp",
      routeName: "Tuyến bảo trì dữ liệu",
      tier: "C",
      lastVisitDate: "-",
      lastOrderDate: "-",
      monthlyRevenue: 0,
      status: "inactive"
    }
  ]
};
