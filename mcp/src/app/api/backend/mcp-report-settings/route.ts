import { backendReadRows } from "@/lib/api/backend-read";
import { proxyBackendRequest } from "@/lib/api/backend-proxy";

export const dynamic = "force-dynamic";

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

function booleanOr(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  const normalized = text(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function settingValue(value: unknown, fallback: string) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const groupType = text(searchParams.get("groupType")) || "market_report";
    const includeInactive = searchParams.get("includeInactive") === "1";
    const filters = includeInactive ? undefined : { active: true };

    const [groupRows, itemRows] = await Promise.all([
      backendReadRows<Row>("mcp_report_setting_groups", {
        order: "sort_order.asc,group_name.asc",
        limit: 5000,
        filters,
        request
      }),
      backendReadRows<Row>("mcp_report_settings", {
        order: "sort_order.asc,setting_name.asc",
        limit: 50000,
        filters,
        request
      })
    ]);

    const groups = groupRows
      .filter((row) => {
        const rawPayload = objectOrEmpty(row.raw_payload);
        const rowType = text(rawPayload.groupType || rawPayload.group_type || rawPayload.type) || "market_report";
        return rowType === groupType;
      })
      .map((group) => {
        const id = text(group.id);
        const active = booleanOr(group.active, true);
        const rawPayload = objectOrEmpty(group.raw_payload);
        const items = itemRows
          .filter((item) => text(item.group_id) === id)
          .map((item) => {
            const itemRawPayload = objectOrEmpty(item.raw_payload);
            const label = text(item.setting_name) || text(item.setting_key);
            return {
              id: text(item.id),
              key: text(item.setting_key),
              label,
              value: settingValue(item.value, label),
              category: text(itemRawPayload.category),
              brandName: text(itemRawPayload.brandName || itemRawPayload.brand_name),
              productId: text(itemRawPayload.productId || itemRawPayload.product_id),
              status: booleanOr(item.active, true) ? "active" : "inactive",
              sortOrder: Number(item.sort_order || 0),
              meta: {
                ...itemRawPayload,
                valueType: text(item.value_type) || "text",
                options: Array.isArray(item.options) ? item.options : [],
                required: booleanOr(item.required, false)
              }
            };
          });

        return {
          id,
          key: text(group.group_key),
          title: text(group.group_name) || text(group.group_key),
          type: groupType,
          description: text(group.description),
          status: active ? "active" : "inactive",
          sortOrder: Number(group.sort_order || 0),
          meta: rawPayload,
          items
        };
      });

    return Response.json(
      { data: { groups }, receivedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "mcp_report_settings_failed";
    return Response.json(
      { ok: false, error: code },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(request: Request) {
  return proxyBackendRequest(request, "/api/mcp-report-settings", "POST");
}

export async function PATCH(request: Request) {
  return proxyBackendRequest(request, "/api/mcp-report-settings", "PATCH");
}
