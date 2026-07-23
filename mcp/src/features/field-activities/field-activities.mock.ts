import type { FieldActivitiesData } from "./field-activities.types";

export const fieldActivitiesMock: FieldActivitiesData = {
  kpis: [
    { label: "Luot ghe", value: 18, hint: "Du lieu mau" },
    { label: "Hoan thanh", value: 15, hint: "Da co ket qua" },
    { label: "Can xu ly", value: 3, hint: "Can xem lai" },
    { label: "Co don", value: 2, hint: "Phat sinh don" }
  ],
  activities: [
    {
      id: "act-001",
      date: "2026-06-30",
      routeName: "Tuyen Cho Gao",
      accountName: "Diem ban Minh Chau",
      owner: "Sale A",
      startTime: "08:15",
      durationMinutes: 18,
      outcome: "Co nhu cau dat them hang",
      hasOrder: true,
      status: "completed"
    },
    {
      id: "act-002",
      date: "2026-06-30",
      routeName: "Tuyen Cho Gao",
      accountName: "Diem ban Thanh Phat",
      owner: "Sale A",
      startTime: "09:05",
      durationMinutes: 22,
      outcome: "Da ghi nhan don moi",
      hasOrder: true,
      status: "completed"
    },
    {
      id: "act-003",
      date: "2026-06-30",
      routeName: "Tuyen My Tho",
      accountName: "Diem ban Huong Que",
      owner: "Sale B",
      startTime: "10:20",
      durationMinutes: 12,
      outcome: "Hen ghe lai",
      hasOrder: false,
      status: "follow_up"
    },
    {
      id: "act-004",
      date: "2026-06-29",
      routeName: "Tuyen Go Cong",
      accountName: "Diem ban Ven Song",
      owner: "Sale C",
      startTime: "-",
      durationMinutes: 0,
      outcome: "Chua thuc hien",
      hasOrder: false,
      status: "missed"
    },
    {
      id: "act-005",
      date: "2026-06-30",
      routeName: "Tuyen Cai Be",
      accountName: "Diem ban Tan Loi",
      owner: "Sale A",
      startTime: "14:35",
      durationMinutes: 25,
      outcome: "Can bo sung vat pham trung bay",
      hasOrder: false,
      status: "follow_up"
    }
  ]
};
