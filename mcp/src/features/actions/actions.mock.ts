import type { ActionsData } from "./actions.types";

export const actionsMock: ActionsData = {
  kpis: [
    { label: "Việc mở", value: 9, hint: "Cần xử lý" },
    { label: "Ưu tiên cao", value: 3, hint: "Làm trước" },
    { label: "Đang làm", value: 4, hint: "Có owner" },
    { label: "Trễ hạn", value: 1, hint: "Cần nhắc" }
  ],
  items: [
    {
      id: "act-001",
      title: "Ghé lại điểm bán đóng cửa",
      accountName: "Điểm bán Ven Sông",
      routeName: "Tuyến Gò Công",
      owner: "Sale C",
      source: "session",
      priority: "high",
      status: "todo",
      dueDate: "2026-07-04",
      note: "Bỏ qua trong phiên gần nhất"
    },
    {
      id: "act-002",
      title: "Bổ sung hàng sắp hết",
      accountName: "Điểm bán Thành Phát",
      routeName: "Tuyến Chợ Gạo",
      owner: "Sale A",
      source: "field_check",
      priority: "high",
      status: "doing",
      dueDate: "2026-07-04",
      note: "Tồn kho thấp"
    },
    {
      id: "act-003",
      title: "Theo dõi đơn chờ giao",
      accountName: "Điểm bán Minh Châu",
      routeName: "Tuyến Chợ Gạo",
      owner: "Kho",
      source: "order",
      priority: "medium",
      status: "doing",
      dueDate: "2026-07-05",
      note: "Đơn đã chốt"
    },
    {
      id: "act-004",
      title: "Đề xuất thêm điểm phát sinh vào tuyến",
      accountName: "Điểm bán Phát Sinh",
      routeName: "Tuyến Chợ Gạo",
      owner: "Admin",
      source: "session",
      priority: "medium",
      status: "todo",
      dueDate: "2026-07-06",
      note: "Cần duyệt vào tuyến gốc"
    },
    {
      id: "act-005",
      title: "Kiểm tra giá đối thủ",
      accountName: "Điểm bán Tân Lợi",
      routeName: "Tuyến Cái Bè",
      owner: "Sale B",
      source: "field_check",
      priority: "low",
      status: "blocked",
      dueDate: "2026-07-05",
      note: "Thiếu ảnh kệ hàng"
    }
  ]
};
