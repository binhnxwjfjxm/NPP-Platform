import { providerPersistence } from "./provider-runtime.js";

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const READ_TABLES = new Set([
  "mcp_routes",
  "mcp_route_customers",
  "mcp_route_sessions",
  "mcp_session_customers",
  "mcp_visits",
  "mcp_followups",
  "mcp_session_reports",
  "market_reports",
  "mcp_report_setting_groups",
  "mcp_report_settings",
  "mcp_report_templates",
  "test_files",
  "test_file_products",
  "test_customers",
  "test_customer_results",
  "orders",
  "order_items",
  "accounts",
  "products",
  "product_variants",
  "route_customers",
  "mcp_outlet_media"
]);
const CANONICAL_LOCATION_COLUMN = "__canonical_google_maps_url";

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function fail(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.providerMessage = code;
  error.statusCode = statusCode;
  throw error;
}

function quoteIdentifier(value) {
  if (!SAFE_IDENTIFIER.test(value)) fail("invalid_read_identifier");
  return `"${value}"`;
}

function filterClause(key, value, params) {
  const column = quoteIdentifier(key);
  const raw = String(value || "");
  if (raw === "is.null") return `${column} IS NULL`;
  if (raw === "not.is.null") return `${column} IS NOT NULL`;
  const prefixes = [
    ["eq.", "="],
    ["neq.", "<>"],
    ["gte.", ">="],
    ["lte.", "<="],
    ["gt.", ">"],
    ["lt.", "<"],
    ["ilike.", "ILIKE"],
    ["like.", "LIKE"]
  ];
  for (const [prefix, operator] of prefixes) {
    if (raw.startsWith(prefix)) {
      params.push(raw.slice(prefix.length));
      return `${column} ${operator} $${params.length}`;
    }
  }
  params.push(raw);
  return `${column} = $${params.length}`;
}

function boundedInteger(value, fallback, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(Math.trunc(parsed), maximum));
}

function readSource(table) {
  if (table !== "mcp_route_customers") return `"mcp".${quoteIdentifier(table)}`;
  return `(
    SELECT route_customer.*,
           CASE
             WHEN route_customer.core_onboarding_status IN ('approved', 'linked_existing')
              AND route_customer.core_customer_id IS NOT NULL
              AND route_customer.core_customer_address_id IS NOT NULL
             THEN CASE
               WHEN customer_address.is_active IS TRUE THEN customer_address.location_url
               ELSE NULL
             END
             ELSE route_customer.google_maps_url
           END AS "${CANONICAL_LOCATION_COLUMN}"
    FROM "mcp"."mcp_route_customers" AS route_customer
    LEFT JOIN "shared"."customer_addresses" AS customer_address
      ON customer_address.installation_id = route_customer.installation_id
     AND customer_address.customer_id = route_customer.core_customer_id
     AND customer_address.id = route_customer.core_customer_address_id
  ) AS "mcp_route_customers"`;
}

function selectedColumns(table, selectRaw) {
  if (!selectRaw || selectRaw === "*") return "*";
  const names = selectRaw.split(",").map((item) => item.trim());
  const selected = names.map((item) => quoteIdentifier(item)).join(", ");
  return table === "mcp_route_customers" && names.includes("google_maps_url")
    ? `${selected}, "${CANONICAL_LOCATION_COLUMN}"`
    : selected;
}

function canonicalizeRouteCustomerRows(table, rows) {
  if (table !== "mcp_route_customers") return rows;
  return rows.map((row) => {
    if (!Object.prototype.hasOwnProperty.call(row, CANONICAL_LOCATION_COLUMN)) return row;
    const result = { ...row, google_maps_url: row[CANONICAL_LOCATION_COLUMN] ?? null };
    delete result[CANONICAL_LOCATION_COLUMN];
    return result;
  });
}

export async function postgresqlRead(config, resource, { method = "GET" } = {}) {
  if (String(method).toUpperCase() !== "GET") fail("postgresql_rest_write_not_implemented", 503);
  const installationId = text(config.installationId);
  if (!installationId) fail("installation_id_required");

  const url = new URL(resource, "http://mcp.local/");
  const table = url.pathname.replace(/^\/+/, "");
  if (!READ_TABLES.has(table)) fail("invalid_read_table");

  const selectRaw = text(url.searchParams.get("select"));
  const columns = selectedColumns(table, selectRaw);

  const params = [installationId];
  const clauses = [
    table === "mcp_report_templates"
      ? `("installation_id" = $1 OR "installation_id" IS NULL)`
      : `"installation_id" = $1`
  ];
  for (const [key, value] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset", "installation_id"].includes(key)) continue;
    clauses.push(filterClause(key, value, params));
  }

  const orderRaw = text(url.searchParams.get("order"));
  const order = orderRaw
    ? ` ORDER BY ${orderRaw.split(",").map((term) => {
        const [name, direction = "asc"] = term.split(".");
        return `${quoteIdentifier(name)} ${direction.toLowerCase() === "desc" ? "DESC" : "ASC"}`;
      }).join(", ")}`
    : "";
  const limit = boundedInteger(url.searchParams.get("limit"), 500, 50000);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  params.push(limit, offset);

  const sql = `SELECT ${columns} FROM ${readSource(table)} WHERE ${clauses.join(" AND ")}${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const persistence = providerPersistence();
  await persistence.assertReady();
  return persistence.withTransaction(async (client) => {
    const result = await client.query(sql, params);
    return canonicalizeRouteCustomerRows(table, result.rows || []);
  });
}

export const postgresqlReadInternals = Object.freeze({
  CANONICAL_LOCATION_COLUMN,
  readSource,
  selectedColumns,
  canonicalizeRouteCustomerRows,
});
