import type { McpDayData } from "./mcp-day.types";

export const mcpDayMock: McpDayData = {
  run: {
    id: "day-001",
    routeName: "Tuyen Cho Gao",
    date: "2026-07-03",
    owner: "Sale A",
    status: "opened",
    openedAt: "08:00"
  },
  kpis: [
    { label: "Trong phien", value: 6, hint: "Snapshot ngay" },
    { label: "Da ghe", value: 2, hint: "Co ket qua" },
    { label: "Cho xu ly", value: 2, hint: "Chua ghe" },
    { label: "Phat sinh", value: 1, hint: "Them trong ngay" }
  ],
  lines: [
    { id: "line-001", sortOrder: 1, accountName: "Diem ban Minh Chau", area: "Cho Gao", source: "planned", status: "visited", note: "Tu tuyen goc", result: "Co nhu cau", hasOrder: true },
    { id: "line-002", sortOrder: 2, accountName: "Diem ban Thanh Phat", area: "Cho Gao", source: "planned", status: "visited", note: "Tu tuyen goc", result: "Co don", hasOrder: true },
    { id: "line-003", sortOrder: 3, accountName: "Diem ban Huong Que", area: "Cho Gao", source: "planned", status: "pending", note: "Con trong lich", hasOrder: false },
    { id: "line-004", sortOrder: 4, accountName: "Diem ban Ven Song", area: "Cho Gao", source: "planned", status: "skipped", note: "Bo qua co ly do", result: "Dong cua", hasOrder: false },
    { id: "line-005", sortOrder: 5, accountName: "Diem ban Tan Loi", area: "Cho Gao", source: "synced", status: "pending", note: "Dong bo them", hasOrder: false },
    { id: "line-006", sortOrder: 6, accountName: "Diem ban Phat Sinh", area: "Cho Gao", source: "added", status: "pending", note: "Them trong ngay", hasOrder: false }
  ],
  results: [
    { id: "result-001", lineId: "line-001", accountName: "Diem ban Minh Chau", startTime: "08:15", endTime: "08:33", result: "Co nhu cau", hasOrder: true, nextAction: "Theo don" },
    { id: "result-002", lineId: "line-002", accountName: "Diem ban Thanh Phat", startTime: "09:05", endTime: "09:27", result: "Co don", hasOrder: true, nextAction: "Giao hang" }
  ]
};
