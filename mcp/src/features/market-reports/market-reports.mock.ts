import type { MarketReportItem, MarketReportsData } from "./market-reports.types";

const emptyOverview = {
  planned: 0,
  visited: 0,
  pending: 0,
  skipped: 0,
  observations: 0,
  orders: 0,
  tests: 0,
  followups: 0
};

const emptySections = {
  overview: emptyOverview,
  competitors: [],
  usedProducts: [],
  opportunities: [],
  risks: [],
  nextActions: [],
  observations: [],
  orders: [],
  tests: [],
  followups: [],
  skipped: [],
  customers: []
};

function mockReport(input: Pick<MarketReportItem, "id" | "date" | "routeName" | "accountName" | "reportType" | "subject" | "note" | "nextAction" | "status"> & Partial<MarketReportItem>): MarketReportItem {
  return {
    sessionId: `mock-session-${input.id}`,
    score: input.status === "risk" ? 30 : input.status === "opportunity" ? 75 : 50,
    health: input.status === "risk" ? "risk" : input.status === "opportunity" ? "good" : "watch",
    warnings: input.status === "risk" ? [input.note] : [],
    recommendedActions: input.nextAction ? [{ priority: input.status === "risk" ? "high" : "medium", action: input.nextAction, reason: input.note }] : [],
    insights: {
      summary: input.note,
      reasons: input.note ? [input.note] : [],
      opportunities: input.status === "opportunity" ? [input.note] : [],
      risks: input.status === "risk" ? [input.note] : [],
      dataQuality: {
        customerDetails: 0,
        expectedCustomers: 0,
        completeCustomerCoverage: true,
        customersWithSignals: 0,
        visitedWithoutSignals: 0
      }
    },
    overview: { ...emptyOverview },
    sections: { ...emptySections, overview: { ...emptyOverview } },
    ...input
  };
}

export const marketReportsMock: MarketReportsData = {
  kpis: [
    { label: "Báo cáo", value: 12, hint: "Trong kỳ" },
    { label: "Cơ hội", value: 4, hint: "Cần bám sát" },
    { label: "Rủi ro", value: 3, hint: "Cần xử lý" },
    { label: "Theo dõi", value: 5, hint: "Đã tạo việc" }
  ],
  reports: [
    mockReport({
      id: "mr-001",
      date: "2026-07-03",
      routeName: "Tuyến Chợ Gạo",
      accountName: "Điểm bán Minh Châu",
      reportType: "price",
      subject: "Giá kệ đối thủ thấp hơn",
      competitorName: "Đối thủ A",
      price: 16500,
      note: "Giá bán thấp hơn khoảng 1.000đ so với hàng mình.",
      nextAction: "Kiểm tra chính sách giá và khuyến mãi",
      status: "risk"
    }),
    mockReport({
      id: "mr-002",
      date: "2026-07-03",
      routeName: "Tuyến Chợ Gạo",
      accountName: "Điểm bán Thành Phát",
      reportType: "display",
      subject: "Vị trí trưng bày tốt",
      competitorName: "",
      price: 0,
      note: "Có thể xin thêm mặt kệ cho SKU chủ lực.",
      nextAction: "Đề xuất POSM và tăng hiện diện",
      status: "opportunity"
    }),
    mockReport({
      id: "mr-003",
      date: "2026-07-02",
      routeName: "Tuyến Cái Bè",
      accountName: "Điểm bán Tân Lợi",
      reportType: "stock",
      subject: "Tồn kho chậm ra",
      competitorName: "",
      price: 0,
      note: "Hàng còn nhiều, cần kiểm tra sell-out.",
      nextAction: "Lên lịch ghé lại và hỗ trợ bán ra",
      status: "normal"
    })
  ]
};
