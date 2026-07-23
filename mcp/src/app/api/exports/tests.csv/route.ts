import { reportFilename, reportStatus } from "@/lib/export/business-report";
import { csvResponse, yyyyMMdd } from "@/lib/export/csv";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";

type Row = Record<string, unknown>;
type ExportRow = Record<string, string | number | boolean | null | undefined>;

export const dynamic = "force-dynamic";

function key(value: unknown) {
  return String(value || "").trim();
}

function rawText(row: Row, field: string) {
  const raw = row.raw_payload;
  if (!raw || typeof raw !== "object") return "";
  return key((raw as Record<string, unknown>)[field]);
}

function exportRow(file: Row = {}, customer: Row = {}, result: Row = {}, sessionCustomer: Row = {}, session: Row = {}): ExportRow {
  return {
    route_id: key(session.route_id || sessionCustomer.route_id || rawText(result, "route_id")),
    route_name: key(session.route_name),
    session_date: key(session.session_date || rawText(result, "session_date") || file.test_date),
    session_id: key(session.id || sessionCustomer.session_id || rawText(result, "session_id")),
    session_customer_id: key(sessionCustomer.id || rawText(result, "session_customer_id")),
    file_id: key(file.id),
    file_title: key(file.title),
    test_date: key(file.test_date),
    sales: key(file.sales || session.sales),
    file_status: key(file.status),
    file_note: key(file.note),
    file_sync_status: key(file.sync_status),
    customer_row_id: key(customer.id),
    customer_name: key(sessionCustomer.customer_name || customer.customer_name),
    phone: key(sessionCustomer.phone || customer.phone),
    area: key(sessionCustomer.area || customer.area || session.area),
    customer_status: key(customer.status || sessionCustomer.visit_status),
    customer_note: key(customer.note || sessionCustomer.note),
    result_id: key(result.id),
    product_id: key(result.product_id),
    product_name: key(result.product_name),
    result_status: key(result.status),
    result_note: key(result.note),
    created_at: key(result.created_at || customer.created_at || file.created_at),
    updated_at: key(result.updated_at || customer.updated_at || file.updated_at)
  };
}

function buildSessionMaps(sessions: Row[], sessionCustomers: Row[], results: Row[]) {
  const sessionsById = sessions.reduce<Record<string, Row>>((acc, session) => { acc[key(session.id)] = session; return acc; }, {});
  const bySessionCustomerId = sessionCustomers.reduce<Record<string, Row>>((acc, item) => { acc[key(item.id)] = item; return acc; }, {});
  const byTestId = sessionCustomers.reduce<Record<string, Row>>((acc, item) => { if (key(item.test_id)) acc[key(item.test_id)] = item; return acc; }, {});

  const contextByResultId = results.reduce<Record<string, { sessionCustomer: Row; session: Row }>>((acc, result) => {
    const sessionCustomer = bySessionCustomerId[rawText(result, "session_customer_id")] || byTestId[key(result.id)] || {};
    const session = sessionsById[key(sessionCustomer.session_id) || rawText(result, "session_id")] || {};
    acc[key(result.id)] = { sessionCustomer, session };
    return acc;
  }, {});

  return { contextByResultId };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const [sessions, sessionCustomers, files] = await Promise.all([
      restRows<Row>("mcp_route_sessions", {
        select: "id,route_id,route_name,session_date,sales,area,status,created_at,updated_at",
        order: "session_date.desc,updated_at.desc",
        limit: 5000,
        filters: { route_id: params.get("routeId") || params.get("route_id"), session_date: params.get("date") || params.get("sessionDate") || params.get("session_date") }
      }),
      restRows<Row>("mcp_session_customers", {
        select: "id,session_id,route_id,route_customer_id,customer_id,customer_name,phone,area,visit_status,test_id,note,created_at,updated_at",
        order: "session_id.asc,sort_order.asc",
        limit: 20000
      }),
      restRows<Row>("test_files", {
        select: "id,title,test_date,sales,status,note,sync_status,raw_payload,created_at,updated_at",
        order: "test_date.desc,created_at.desc",
        limit: Number(params.get("limit") || 3000),
        filters: { id: params.get("fileId") || params.get("file_id"), test_date: params.get("date"), sales: params.get("sales"), status: params.get("fileStatus") }
      })
    ]);

    const fileIds = new Set(files.map((file) => key(file.id)).filter(Boolean));
    const customers = (await restRows<Row>("test_customers", {
      select: "id,file_id,customer_name,phone,area,status,note,raw_payload,created_at,updated_at",
      order: "file_id.asc,customer_name.asc",
      limit: 12000,
      filters: { file_id: params.get("fileId") || params.get("file_id"), status: params.get("customerStatus") }
    })).filter((customer) => !fileIds.size || fileIds.has(key(customer.file_id)));

    const customerIds = new Set(customers.map((customer) => key(customer.id)).filter(Boolean));
    const results = (await restRows<Row>("test_customer_results", {
      select: "id,file_id,customer_id,product_id,product_name,status,note,raw_payload,created_at,updated_at",
      order: "file_id.asc,customer_id.asc,product_name.asc",
      limit: 20000,
      filters: { file_id: params.get("fileId") || params.get("file_id"), status: params.get("resultStatus") }
    })).filter((result) => (!customerIds.size || customerIds.has(key(result.customer_id))) && (!fileIds.size || fileIds.has(key(result.file_id))));

    const filesById = files.reduce<Record<string, Row>>((acc, file) => { acc[key(file.id)] = file; return acc; }, {});
    const customersById = customers.reduce<Record<string, Row>>((acc, customer) => { acc[key(customer.id)] = customer; return acc; }, {});
    const resultCustomerIds = new Set(results.map((result) => key(result.customer_id)).filter(Boolean));
    const customerFileIds = new Set(customers.map((customer) => key(customer.file_id)).filter(Boolean));
    const { contextByResultId } = buildSessionMaps(sessions, sessionCustomers, results);

    const rows: ExportRow[] = [
      ...results.map((result) => {
        const context = contextByResultId[key(result.id)] || { sessionCustomer: {}, session: {} };
        return exportRow(filesById[key(result.file_id)], customersById[key(result.customer_id)], result, context.sessionCustomer, context.session);
      }),
      ...customers.filter((customer) => !resultCustomerIds.has(key(customer.id))).map((customer) => exportRow(filesById[key(customer.file_id)], customer)),
      ...files.filter((file) => !customerFileIds.has(key(file.id))).map((file) => exportRow(file))
    ];

    return csvResponse(reportFilename("ket-qua-thu-san-pham", [yyyyMMdd()], "csv"), [
      { key: "session_date", header: "Ngày phiên" },
      { key: "route_name", header: "Tuyến" },
      { key: "test_date", header: "Ngày thử sản phẩm" },
      { key: "sales", header: "Nhân viên phụ trách" },
      { key: "file_title", header: "Tên phiếu thử" },
      { key: "file_status", header: "Trạng thái phiếu", value: (row) => reportStatus(row.file_status) },
      { key: "customer_name", header: "Tên điểm bán" },
      { key: "phone", header: "Số điện thoại" },
      { key: "area", header: "Khu vực" },
      { key: "customer_status", header: "Kết quả ghé", value: (row) => reportStatus(row.customer_status) },
      { key: "product_name", header: "Sản phẩm được thử" },
      { key: "result_status", header: "Kết quả thử", value: (row) => reportStatus(row.result_status) },
      { key: "result_note", header: "Ghi chú kết quả" },
      { key: "customer_note", header: "Ghi chú điểm bán" },
      { key: "file_note", header: "Ghi chú chung" },
      { key: "file_sync_status", header: "Trạng thái đồng bộ", value: (row) => reportStatus(row.file_sync_status) },
      { key: "route_id", header: "Mã tuyến" },
      { key: "session_id", header: "Mã phiên" },
      { key: "session_customer_id", header: "Mã điểm bán trong phiên" },
      { key: "file_id", header: "Mã phiếu thử" },
      { key: "customer_row_id", header: "Mã điểm bán trong phiếu" },
      { key: "product_id", header: "Mã sản phẩm" },
      { key: "result_id", header: "Mã kết quả" },
      { key: "created_at", header: "Thời điểm tạo" },
      { key: "updated_at", header: "Cập nhật gần nhất" }
    ], rows);
  } catch (error) {
    return errorResponse(error);
  }
}
