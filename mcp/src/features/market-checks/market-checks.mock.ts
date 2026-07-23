import type { MarketChecksData } from "./market-checks.types";

export const marketChecksMock: MarketChecksData = {
  kpis: [
    { label: "Diem da kiem", value: 12, hint: "Du lieu mau" },
    { label: "Co hoi", value: 4, hint: "Gia / trung bay tot" },
    { label: "Rui ro", value: 3, hint: "Doi thu / het hang" },
    { label: "SKU", value: 18, hint: "San pham ghi nhan" }
  ],
  checks: [
    {
      id: "check-001",
      fileId: "test-file-mock-001",
      customerId: "test-customer-mock-001",
      resultId: "check-001",
      date: "2026-07-03",
      routeName: "Tuyen Cho Gao",
      accountName: "Diem ban Minh Chau",
      productName: "Sua hop 180ml",
      competitorName: "Doi thu A",
      shelfPrice: 8200,
      stockStatus: "Con hang",
      note: "Gia on dinh, co the tang trung bay",
      status: "opportunity"
    },
    {
      id: "check-002",
      fileId: "test-file-mock-001",
      customerId: "test-customer-mock-002",
      resultId: "check-002",
      date: "2026-07-03",
      routeName: "Tuyen Cho Gao",
      accountName: "Diem ban Thanh Phat",
      productName: "Nuoc giai khat chai",
      competitorName: "Doi thu B",
      shelfPrice: 10500,
      stockStatus: "Sap het",
      note: "Can bo sung hang truoc cuoi tuan",
      status: "risk"
    },
    {
      id: "check-003",
      fileId: "test-file-mock-002",
      customerId: "test-customer-mock-003",
      resultId: "check-003",
      date: "2026-07-03",
      routeName: "Tuyen My Tho",
      accountName: "Diem ban Huong Que",
      productName: "Banh goi nho",
      competitorName: "Khong ro",
      shelfPrice: 15000,
      stockStatus: "Con hang",
      note: "Ban cham, can theo doi them",
      status: "normal"
    },
    {
      id: "check-004",
      fileId: "test-file-mock-003",
      customerId: "test-customer-mock-004",
      resultId: "check-004",
      date: "2026-07-02",
      routeName: "Tuyen Go Cong",
      accountName: "Diem ban Ven Song",
      productName: "Sua chua uong",
      competitorName: "Doi thu C",
      shelfPrice: 7200,
      stockStatus: "Het hang",
      note: "Mat vi tri ke hang vao doi thu",
      status: "risk"
    },
    {
      id: "check-005",
      fileId: "test-file-mock-004",
      customerId: "test-customer-mock-005",
      resultId: "check-005",
      date: "2026-07-02",
      routeName: "Tuyen Cai Be",
      accountName: "Diem ban Tan Loi",
      productName: "Tra dong chai",
      competitorName: "Doi thu A",
      shelfPrice: 9000,
      stockStatus: "Con hang",
      note: "Co co hoi khuyen mai combo",
      status: "opportunity"
    }
  ]
};
