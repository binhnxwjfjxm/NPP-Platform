import http from "node:http";

const port = Number(process.env.EXPORT_MOCK_PORT || 3112);

const sections = {
  overview: { planned: 2, visited: 1, pending: 1, skipped: 0, observations: 1, orders: 1, tests: 1, followups: 1 },
  competitors: [{ label: "Đối thủ A", count: 1 }],
  usedProducts: [{ label: "Trà sữa nhãn B", count: 1 }],
  opportunities: ["Điểm bán quan tâm dòng siro mới."],
  risks: ["Một điểm bán chưa được ghé."],
  nextActions: ["Gọi lại điểm bán vào ngày mai."],
  observations: [{ id: "obs-1", customerName: "Quán Trà Sữa An Nhiên", competitors: ["Đối thủ A"], usedProducts: ["Trà sữa nhãn B"], note: "Quan tâm chương trình dùng thử." }],
  orders: [{ id: "order-1", code: "ORD-001", customerName: "Quán Trà Sữa An Nhiên", status: "confirmed", total: 220000, note: "Giao buổi sáng." }],
  tests: [{ id: "test-result-1", customerName: "Quán Trà Sữa An Nhiên", productName: "Siro Dâu", status: "interested", note: "Khách phản hồi vị dễ uống." }],
  followups: [{ id: "followup-1", customerName: "Quán Trà Sữa An Nhiên", title: "Gửi bảng giá", dueDate: "2026-07-22", status: "open", priority: "high", note: "Gửi trước 10 giờ." }],
  skipped: []
};

const customerDetails = [
  {
    id: "session-customer-1",
    sortOrder: 1,
    customerName: "Quán Trà Sữa An Nhiên",
    phone: "0909000000",
    area: "Bình Đại",
    visitStatus: "visited",
    statusReason: "",
    note: "Khách cần bảng giá.",
    orders: sections.orders,
    tests: sections.tests,
    observations: sections.observations,
    followups: sections.followups
  },
  {
    id: "session-customer-2",
    sortOrder: 2,
    customerName: "=HYPERLINK(\"https://example.com\",\"Điểm bán B\")",
    phone: "0909000001",
    area: "Bình Đại",
    visitStatus: "pending",
    statusReason: "Chưa ghé",
    note: "",
    orders: [],
    tests: [],
    observations: [],
    followups: []
  }
];

const rowsByTable = {
  mcp_session_reports: [{
    id: "report-1",
    session_id: "session-1",
    route_id: "route-1",
    route_name: "Tuyến Trà Sữa",
    session_date: "2026-07-21",
    sales: "Nguyễn Văn A",
    status: "done",
    schema_version: "mcp.session-report.snapshot.v2",
    kpis: [],
    sections,
    customer_details: customerDetails,
    insights: {
      summary: "Phiên đạt một đơn hàng và còn một điểm bán cần ghé.",
      reasons: ["Đã ghé 1/2 điểm bán."],
      opportunities: sections.opportunities,
      risks: sections.risks,
      dataQuality: { customerDetails: 2, expectedCustomers: 2, completeCustomerCoverage: true, customersWithSignals: 1, visitedWithoutSignals: 0 }
    },
    score: 72,
    health: "watch",
    warnings: ["Còn một điểm bán chưa ghé."],
    recommended_actions: [{ type: "followup", customerId: "customer-1", customerName: "Quán Trà Sữa An Nhiên", priority: "high", action: "Gửi bảng giá", reason: "Khách đã yêu cầu." }],
    ai_prompt_context: { internal: true },
    ai_result: { result: { summary: "Dữ liệu AI nội bộ không được in thẳng." } },
    snapshot_source: "session_close",
    snapshot_at: "2026-07-21T08:30:00.000Z",
    created_at: "2026-07-21T08:30:00.000Z",
    updated_at: "2026-07-21T08:30:00.000Z"
  }],
  mcp_route_sessions: [{ id: "session-1", route_id: "route-1", route_name: "Tuyến Trà Sữa", session_date: "2026-07-21", sales: "Nguyễn Văn A", area: "Bình Đại", status: "done", planned_customers: 2, visited_customers: 1, order_count: 1, test_count: 1, report_count: 1, followup_count: 1, created_at: "2026-07-21T07:00:00.000Z", updated_at: "2026-07-21T08:30:00.000Z" }],
  orders: [{ id: "order-1", order_code: "ORD-001", order_date: "2026-07-21", sales: "Nguyễn Văn A", customer_id: "customer-1", customer_name: "Quán Trà Sữa An Nhiên", customer_phone: "0909000000", area: "Bình Đại", delivery_address: "12 Đường A", source_type: "orders_tab", source_id: "route-customer-1", status: "confirmed", subtotal: 230000, discount_total: 10000, grand_total: 220000, note: "Giao buổi sáng.", raw_payload: { paymentMethod: "Chuyển khoản", deliveryNote: "Giao trước 10 giờ", paidAmount: 100000 }, sync_status: "synced", created_at: "2026-07-21T08:00:00.000Z", updated_at: "2026-07-21T08:00:00.000Z" }],
  order_items: [{ id: "item-1", order_id: "order-1", product_id: "product-1", variant_id: "variant-1", product_name: "Siro Dâu", sku: "SIRO-DAU", unit: "chai", quantity: 2, unit_price: 115000, discount: 10000, line_total: 220000, note: "750 ml", raw_payload: {}, created_at: "2026-07-21T08:00:00.000Z" }],
  product_variants: [{ id: "variant-1", product_id: "product-1", sku: "SIRO-DAU", variant_name: "Chai 750 ml", size_label: "750 ml", sell_unit: "chai", pack_unit: "thùng", pack_quantity: 12, raw_options: { volume: "750 ml" }, raw_payload: {} }],
  products: [{ id: "product-1", name: "Siro Dâu", brand_code: "HUNG-PHAT", brand_name: "Hưng Phát", category: "Siro", raw_payload: { brandName: "Hưng Phát" } }],
  market_reports: [{ id: "market-1", report_date: "2026-07-21", sales: "Nguyễn Văn A", market_area: "Bình Đại", route_name: "Tuyến Trà Sữa", market_type: "competitor", total_shops: 1, competitor_summary: "Đối thủ A", price_summary: "100.000 - 120.000 đ", demand_summary: "Quan tâm siro", company_product_summary: "Trà sữa nhãn B", opportunity_summary: "Có thể bán thêm siro", risk_summary: "Nhạy cảm giá", next_action: "Gửi bảng giá", note: "Theo dõi tuần sau", sync_status: "synced", raw_payload: { selected: { competitors: [{ label: "Đối thủ A" }], usedProducts: [{ label: "Trà sữa nhãn B" }] }, context: { customerName: "Quán Trà Sữa An Nhiên", routeCustomerId: "route-customer-1" } }, created_at: "2026-07-21T08:10:00.000Z", updated_at: "2026-07-21T08:10:00.000Z", synced_at: "2026-07-21T08:11:00.000Z" }],
  mcp_followups: [{ id: "followup-1", session_id: "session-1", session_customer_id: "session-customer-1", visit_id: "visit-1", route_id: "route-1", route_customer_id: "route-customer-1", customer_id: "customer-1", customer_name: "Quán Trà Sữa An Nhiên", followup_type: "quote", title: "Gửi bảng giá", due_date: "2026-07-22", status: "open", priority: "high", owner: "Nguyễn Văn A", note: "Gửi trước 10 giờ.", created_at: "2026-07-21T08:20:00.000Z", updated_at: "2026-07-21T08:20:00.000Z" }],
  test_files: [{ id: "test-file-1", title: "Thử Siro Dâu", test_date: "2026-07-21", sales: "Nguyễn Văn A", status: "completed", note: "Khách phản hồi tốt.", sync_status: "synced", created_at: "2026-07-21T08:00:00.000Z", updated_at: "2026-07-21T08:00:00.000Z" }],
  test_customers: [{ id: "test-customer-1", file_id: "test-file-1", customer_name: "Quán Trà Sữa An Nhiên", phone: "0909000000", area: "Bình Đại", status: "tested", note: "Quan tâm mua thử.", created_at: "2026-07-21T08:00:00.000Z", updated_at: "2026-07-21T08:00:00.000Z" }],
  test_customer_results: [{ id: "test-result-1", file_id: "test-file-1", customer_id: "test-customer-1", product_id: "product-1", product_name: "Siro Dâu", status: "interested", note: "Vị dễ uống.", raw_payload: { session_id: "session-1", session_customer_id: "session-customer-1" }, created_at: "2026-07-21T08:00:00.000Z", updated_at: "2026-07-21T08:00:00.000Z" }],
  mcp_session_customers: customerDetails.map((customer, index) => ({ id: customer.id, session_id: "session-1", route_id: "route-1", route_customer_id: `route-customer-${index + 1}`, customer_id: `customer-${index + 1}`, customer_name: customer.customerName, phone: customer.phone, area: customer.area, sort_order: customer.sortOrder, source: "planned", visit_status: customer.visitStatus, status_reason: customer.statusReason, order_id: index === 0 ? "order-1" : null, test_id: index === 0 ? "test-result-1" : null, report_id: index === 0 ? "market-1" : null, followup_count: index === 0 ? 1 : 0, note: customer.note, created_at: "2026-07-21T07:00:00.000Z", updated_at: "2026-07-21T08:30:00.000Z" })),
  mcp_route_customers: customerDetails.map((customer, index) => ({ id: `route-customer-${index + 1}`, route_id: "route-1", customer_id: `customer-${index + 1}`, customer_name: customer.customerName, phone: customer.phone, area: customer.area, address: `${index + 12} Đường A`, sort_order: customer.sortOrder, active: true, note: customer.note, geo_lat: index === 0 ? 10.1 : null, geo_lng: index === 0 ? 106.1 : null, geo_accuracy: index === 0 ? 8 : null, geo_captured_at: index === 0 ? "2026-07-21T07:30:00.000Z" : null, geo_source: index === 0 ? "gps" : null, google_maps_url: index === 0 ? "https://maps.google.com" : null, sync_status: "synced", created_at: "2026-07-20T07:00:00.000Z", updated_at: "2026-07-21T07:30:00.000Z" })),
  mcp_routes: [{ id: "route-1", route_name: "Tuyến Trà Sữa" }]
};

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

function tableFromPath(pathname) {
  const match = pathname.match(/^\/rest\/v1\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  if (url.pathname === "/health") return json(response, 200, { ok: true });
  const table = tableFromPath(url.pathname);
  if (!table || !(table in rowsByTable)) return json(response, 404, { message: `unknown_table:${table}` });
  return json(response, 200, rowsByTable[table]);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Export mock Supabase listening on 127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
