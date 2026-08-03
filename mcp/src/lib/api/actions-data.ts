import "server-only";

import type {
  ActionItem,
  ActionPriority,
  ActionSource,
  ActionStatus,
  ActionsData
} from "@/features/actions/actions.types";
import { withoutInternalSmokeRows } from "@/lib/data/internal-smoke";
import { backendReadRows } from "@/lib/api/backend-read";

type Row = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function objectOrEmpty(value: unknown): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {};
    } catch {
      return {};
    }
  }
  return {};
}

function dateOnly(value: unknown) {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : "-";
}

function priority(value: unknown): ActionPriority {
  const normalized = text(value).toLowerCase();
  if (normalized === "urgent" || normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

function status(value: unknown): ActionStatus {
  const normalized = text(value).toLowerCase();
  if (["done", "completed", "closed"].includes(normalized)) return "done";
  if (["doing", "in_progress", "processing"].includes(normalized)) return "doing";
  if (["blocked", "cancelled", "canceled"].includes(normalized)) return "blocked";
  return "todo";
}

function source(row: Row): ActionSource {
  const normalized = text(row.source || row.source_type || row.followup_type).toLowerCase();
  if (text(row.order_id) || normalized.includes("order")) return "order";
  if (text(row.test_id) || text(row.report_id) || normalized.includes("test") || normalized.includes("report") || normalized.includes("field")) {
    return "field_check";
  }
  if (text(row.session_customer_id) || text(row.session_id) || normalized.includes("session")) return "session";
  return "manual";
}

function vietnamBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export async function loadActionsData(): Promise<ActionsData> {
  const [followupRowsRaw, sessionCustomerRows, routeRows] = await Promise.all([
    backendReadRows<Row>("mcp_followups", {
      order: "due_date.asc,created_at.desc",
      limit: 5000
    }),
    backendReadRows<Row>("mcp_session_customers", {
      select: "id,route_id,customer_name,route_customer_id",
      limit: 50000
    }),
    backendReadRows<Row>("mcp_routes", {
      select: "id,route_name",
      limit: 5000
    })
  ]);

  const sessionCustomers = new Map(
    sessionCustomerRows
      .map((row) => [text(row.id), row] as const)
      .filter(([id]) => id)
  );
  const routeNames = new Map(
    routeRows
      .map((row) => [text(row.id), text(row.route_name)] as const)
      .filter(([id]) => id)
  );

  const items: ActionItem[] = withoutInternalSmokeRows(followupRowsRaw)
    .map((row) => {
      const id = text(row.id);
      const rawPayload = objectOrEmpty(row.raw_payload);
      const context = objectOrEmpty(rawPayload.context);
      const sessionCustomer = sessionCustomers.get(text(row.session_customer_id));
      const routeId = text(row.route_id) || text(sessionCustomer?.route_id);
      const accountName = text(row.customer_name || row.account_name)
        || text(context.customerName || context.customer_name)
        || text(sessionCustomer?.customer_name)
        || "Điểm bán chưa xác định";
      const routeName = text(row.route_name)
        || text(context.routeName || context.route_name)
        || routeNames.get(routeId)
        || "Tuyến chưa xác định";

      return {
        id,
        title: text(row.title) || "Việc cần theo dõi",
        accountName,
        routeName,
        owner: text(row.owner || row.sales) || "Chưa phân công",
        source: source(row),
        priority: priority(row.priority),
        status: status(row.status),
        dueDate: dateOnly(row.due_date || row.created_at),
        note: text(row.note) || "Chưa có ghi chú."
      } satisfies ActionItem;
    })
    .filter((item) => item.id);

  const openItems = items.filter((item) => item.status !== "done");
  const today = vietnamBusinessDate();
  const overdue = openItems.filter((item) => item.dueDate !== "-" && item.dueDate < today).length;

  return {
    kpis: [
      { label: "Tổng việc", value: items.length, hint: "Từ PostgreSQL" },
      { label: "Cần xử lý", value: openItems.length, hint: "Chưa hoàn tất" },
      { label: "Ưu tiên cao", value: openItems.filter((item) => item.priority === "high").length, hint: "Cần xem trước" },
      { label: "Quá hạn", value: overdue, hint: "Theo ngày đến hạn" }
    ],
    items
  };
}
