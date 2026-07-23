import { reportDate, reportStatus } from "@/lib/export/business-report";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";
import { esc, htmlResponse, kv, table } from "@/lib/export/print";

type Row = Record<string, string | number | boolean | null>;

type TestRow = Row & {
  customer_name?: string | null;
  customer_status?: string | null;
  product_name?: string | null;
  result_status?: string | null;
  result_note?: string | null;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const files = await restRows<Row>("test_files", { select: "*", order: "test_date.desc,created_at.desc", limit: 1, filters: { id: params.get("fileId"), test_date: params.get("date"), sales: params.get("sales") } });
    const file = files[0];
    if (!file) return htmlResponse("Không tìm thấy phiếu thử sản phẩm", `<h1>Không tìm thấy phiếu thử sản phẩm</h1><p class="muted">Hãy quay lại danh sách kết quả thử và chọn lại phiếu cần xem.</p>`);
    const customers = await restRows<Row>("test_customers", { select: "*", order: "customer_name.asc", limit: 3000, filters: { file_id: String(file.id || "") } });
    const results = await restRows<Row>("test_customer_results", { select: "*", order: "customer_id.asc,product_name.asc", limit: 5000, filters: { file_id: String(file.id || "") } });
    const byCustomer = customers.reduce<Record<string, Row>>((acc, customer) => { acc[String(customer.id || "")] = customer; return acc; }, {});
    const rows: TestRow[] = results.length ? results.map((result) => { const customer = byCustomer[String(result.customer_id || "")] || {}; return { ...result, customer_name: String(customer.customer_name || ""), phone: customer.phone, area: customer.area, customer_status: String(customer.status || ""), result_status: String(result.status || ""), result_note: String(result.note || "") }; }) : customers.map((customer) => ({ ...customer, customer_name: String(customer.customer_name || ""), customer_status: String(customer.status || "") }));
    const body = `<div class="head"><div><div class="brand">Phiếu phục vụ bán hàng</div><h1>Phiếu kết quả thử sản phẩm</h1><p class="muted">${esc(file.title || "Phiếu thử sản phẩm")}</p></div><div>${kv([["Ngày thực hiện", reportDate(file.test_date)], ["Nhân viên phụ trách", file.sales || "Chưa phân công"], ["Trạng thái", reportStatus(file.status)]])}</div></div>
    <section class="box"><h2>Ghi chú chung</h2><p>${esc(file.note || "Không có ghi chú bổ sung.")}</p></section>
    <h2>Kết quả theo điểm bán và sản phẩm</h2>${table<TestRow>([
      { header: "STT", value: (_row, index) => index + 1, className: "center" },
      { header: "Điểm bán", value: (row) => row.customer_name },
      { header: "Số điện thoại", value: (row) => row.phone },
      { header: "Khu vực", value: (row) => row.area },
      { header: "Sản phẩm", value: (row) => row.product_name },
      { header: "Kết quả", value: (row) => reportStatus(row.result_status || row.customer_status) },
      { header: "Ghi chú", value: (row) => row.result_note || row.note }
    ], rows)}`;
    return htmlResponse(`Phiếu kết quả thử sản phẩm - ${String(file.title || "")}`, body);
  } catch (error) {
    return errorResponse(error);
  }
}
