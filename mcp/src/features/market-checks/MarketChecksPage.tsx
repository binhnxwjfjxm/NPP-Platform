import { restRows } from "@/lib/export/supabase-rest";
import type { MarketCheckItem, MarketCheckSessionGroup, MarketCheckStatus } from "./market-checks.types";
import { MarketChecksClientPage } from "./MarketChecksClientPage";

type Row = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function num(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rawText(row: Row, key: string) {
  const raw = row.raw_payload;
  if (!raw || typeof raw !== "object") return "";
  return text((raw as Record<string, unknown>)[key]);
}

function status(value: unknown): MarketCheckStatus {
  const normalized = text(value).toLowerCase();
  if (["ok", "interested", "sample", "opportunity", "good", "success", "passed", "positive"].includes(normalized)) return "opportunity";
  if (["bad", "retry", "follow", "risk", "fail", "failed", "issue", "problem"].includes(normalized)) return "risk";
  return "normal";
}

function toCheck(session: Row, sessionCustomer: Row, file: Row, customer: Row, result: Row = {}): MarketCheckItem {
  const sessionId = text(session.id || sessionCustomer.session_id || rawText(result, "session_id"));
  const sessionCustomerId = text(sessionCustomer.id || rawText(result, "session_customer_id"));
  const routeId = text(session.route_id || sessionCustomer.route_id);
  const sessionDate = text(session.session_date).slice(0, 10) || text(file.test_date).slice(0, 10);
  const fileId = text(file.id || customer.file_id || result.file_id);
  const customerId = text(customer.id || result.customer_id);
  const resultId = text(result.id);
  const productName = text(result.product_name) || text(file.title) || "Sản phẩm test";
  const resultStatus = status(result.status || customer.status || file.status);

  return {
    id: resultId || `${sessionCustomerId}:${fileId}:${customerId}`,
    fileId,
    customerId,
    resultId: resultId || undefined,
    productId: text(result.product_id) || undefined,
    sessionId: sessionId || undefined,
    sessionCustomerId: sessionCustomerId || undefined,
    routeId: routeId || undefined,
    sessionDate: sessionDate || undefined,
    date: sessionDate,
    routeName: text(session.route_name) || text(file.title) || "Phiên MCP",
    accountName: text(sessionCustomer.customer_name || customer.customer_name) || "Khách chưa đặt tên",
    phone: text(sessionCustomer.phone || customer.phone) || undefined,
    area: text(sessionCustomer.area || customer.area || session.area) || undefined,
    productName,
    competitorName: "-",
    shelfPrice: 0,
    stockStatus: text(result.status || customer.status || file.status) || "Chờ nhập",
    note: text(result.note || customer.note || file.note || sessionCustomer.note) || "Chưa có ghi chú",
    status: resultStatus
  };
}

function groupRows(sessions: Row[], sessionCustomers: Row[], files: Row[], customers: Row[], results: Row[]): MarketCheckSessionGroup[] {
  const sessionsById = sessions.reduce<Record<string, Row>>((acc, session) => {
    acc[text(session.id)] = session;
    return acc;
  }, {});
  const filesById = files.reduce<Record<string, Row>>((acc, file) => {
    acc[text(file.id)] = file;
    return acc;
  }, {});
  const customersById = customers.reduce<Record<string, Row>>((acc, customer) => {
    acc[text(customer.id)] = customer;
    return acc;
  }, {});

  const resultsBySessionCustomerId = results.reduce<Record<string, Row[]>>((acc, result) => {
    const sessionCustomerId = rawText(result, "session_customer_id");
    if (sessionCustomerId) acc[sessionCustomerId] = [...(acc[sessionCustomerId] || []), result];
    return acc;
  }, {});
  const resultsById = results.reduce<Record<string, Row>>((acc, result) => {
    acc[text(result.id)] = result;
    return acc;
  }, {});

  const grouped = new Map<string, MarketCheckSessionGroup>();

  sessionCustomers
    .filter((sessionCustomer) => text(sessionCustomer.test_id))
    .forEach((sessionCustomer) => {
      const session = sessionsById[text(sessionCustomer.session_id)] || {};
      const sessionId = text(session.id || sessionCustomer.session_id);
      if (!sessionId) return;

      const anchorResult = resultsById[text(sessionCustomer.test_id)];
      const relatedResults = resultsBySessionCustomerId[text(sessionCustomer.id)] || (anchorResult ? [anchorResult] : []);
      const rows = relatedResults.length ? relatedResults : [{}];

      let group = grouped.get(sessionId);
      if (!group) {
        group = {
          id: sessionId,
          sessionId,
          routeId: text(session.route_id || sessionCustomer.route_id),
          routeName: text(session.route_name) || "Phiên MCP",
          sessionDate: text(session.session_date).slice(0, 10),
          sales: text(session.sales) || undefined,
          status: text(session.status) || "active",
          plannedCustomers: num(session.planned_customers),
          visitedCustomers: num(session.visited_customers),
          customerCount: 0,
          resultCount: 0,
          pendingCount: 0,
          opportunityCount: 0,
          riskCount: 0,
          items: []
        };
        grouped.set(sessionId, group);
      }

      rows.forEach((result) => {
        const file = filesById[text(result.file_id)] || {};
        const customer = customersById[text(result.customer_id)] || {};
        const item = toCheck(session, sessionCustomer, file, customer, result);
        group?.items.push(item);
      });
    });

  return Array.from(grouped.values())
    .map((group) => {
      const customersInGroup = new Set(group.items.map((item) => item.sessionCustomerId || item.customerId).filter(Boolean));
      const resultCount = group.items.filter((item) => item.resultId).length;
      const pendingCount = group.items.filter((item) => !item.resultId || item.stockStatus === "pending").length;
      const opportunityCount = group.items.filter((item) => item.status === "opportunity").length;
      const riskCount = group.items.filter((item) => item.status === "risk").length;
      return {
        ...group,
        customerCount: customersInGroup.size,
        resultCount,
        pendingCount,
        opportunityCount,
        riskCount,
        items: group.items.sort((a, b) => a.accountName.localeCompare(b.accountName, "vi"))
      };
    })
    .sort((a, b) => `${b.sessionDate}-${b.sessionId}`.localeCompare(`${a.sessionDate}-${a.sessionId}`));
}

export async function MarketChecksPage() {
  const [sessions, sessionCustomers, files, customers, results] = await Promise.all([
    restRows<Row>("mcp_route_sessions", {
      select: "id,route_id,route_name,session_date,sales,area,status,planned_customers,visited_customers,test_count,created_at,updated_at",
      order: "session_date.desc,updated_at.desc",
      limit: 1000
    }),
    restRows<Row>("mcp_session_customers", {
      select: "id,session_id,route_id,route_customer_id,customer_id,customer_name,phone,area,visit_status,test_id,note,created_at,updated_at",
      order: "updated_at.desc",
      limit: 12000
    }),
    restRows<Row>("test_files", {
      select: "id,title,test_date,sales,status,note,sync_status,raw_payload,created_at,updated_at",
      order: "test_date.desc,created_at.desc",
      limit: 1000
    }),
    restRows<Row>("test_customers", {
      select: "id,file_id,customer_name,phone,area,status,note,raw_payload,created_at,updated_at",
      order: "file_id.asc,customer_name.asc",
      limit: 12000
    }),
    restRows<Row>("test_customer_results", {
      select: "id,file_id,customer_id,product_id,product_name,status,note,raw_payload,created_at,updated_at",
      order: "created_at.desc",
      limit: 20000
    })
  ]);

  const groups = groupRows(sessions, sessionCustomers, files, customers, results);

  return <MarketChecksClientPage groups={groups} />;
}
