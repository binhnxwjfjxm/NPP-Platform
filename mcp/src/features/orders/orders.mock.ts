import type { OrdersData } from "./orders.types";

export const ordersMock: OrdersData = {
  kpis: [
    { label: "Don hang", value: 8, hint: "Du lieu mau" },
    { label: "Doanh so", value: "12.450.000d", hint: "Tong gia tri" },
    { label: "SKU", value: 23, hint: "Mat hang ban" },
    { label: "Cho giao", value: 3, hint: "Can theo doi" }
  ],
  orders: [
    {
      id: "order-001",
      code: "DH-0001",
      date: "2026-07-03",
      accountName: "Diem ban Minh Chau",
      routeName: "Tuyen Cho Gao",
      owner: "Sale A",
      source: "MCP session",
      skuCount: 4,
      quantity: 36,
      totalAmount: 2450000,
      status: "confirmed"
    },
    {
      id: "order-002",
      code: "DH-0002",
      date: "2026-07-03",
      accountName: "Diem ban Thanh Phat",
      routeName: "Tuyen Cho Gao",
      owner: "Sale A",
      source: "Visit result",
      skuCount: 3,
      quantity: 24,
      totalAmount: 1780000,
      status: "delivered"
    },
    {
      id: "order-003",
      code: "DH-0003",
      date: "2026-07-02",
      accountName: "Diem ban Tan Loi",
      routeName: "Tuyen Cai Be",
      owner: "Sale B",
      source: "Phone",
      skuCount: 5,
      quantity: 42,
      totalAmount: 3150000,
      status: "confirmed"
    },
    {
      id: "order-004",
      code: "DH-0004",
      date: "2026-07-02",
      accountName: "Diem ban Huong Que",
      routeName: "Tuyen My Tho",
      owner: "Sale C",
      source: "MCP session",
      skuCount: 2,
      quantity: 18,
      totalAmount: 920000,
      status: "draft"
    },
    {
      id: "order-005",
      code: "DH-0005",
      date: "2026-07-01",
      accountName: "Diem ban Ven Song",
      routeName: "Tuyen Go Cong",
      owner: "Sale C",
      source: "Field check",
      skuCount: 6,
      quantity: 55,
      totalAmount: 4150000,
      status: "confirmed"
    }
  ]
};
