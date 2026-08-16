import { requirePermission } from "./authorization.js";

const SAFE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const RAW_FILTER_PREFIXES = ["eq.", "neq.", "gte.", "lte.", "lt.", "gt.", "ilike.", "like.", "is.", "in."];
const MAX_READ_LIMIT = 50000;
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

const ALLOWED_READ_TABLES = new Set([
  "accounts",
  "market_reports",
  "mcp_followups",
  "mcp_report_setting_groups",
  "mcp_report_settings",
  "mcp_route_customers",
  "mcp_route_sessions",
  "mcp_routes",
  "mcp_session_customers",
  "mcp_session_reports",
  "mcp_visits",
  "order_items",
  "orders",
  "product_variants",
  "products",
  "route_customers",
  "test_customer_results",
  "test_customers",
  "test_file_products",
  "test_files"
]);

const INSTALLATION_SCOPED_READ_TABLES = new Set([
  "mcp_followups",
  "mcp_report_setting_groups",
  "mcp_report_settings",
  "mcp_route_customers",
  "mcp_route_sessions",
  "mcp_session_customers",
  "mcp_session_reports",
  "mcp_visits"
]);

const READ_PERMISSION_BY_TABLE = new Map([
  ["mcp_report_setting_groups", "mcp.report-setting.write"],
  ["mcp_report_settings", "mcp.report-setting.write"]
]);

function text(value) {
  return String(value ?? "").trim();
}

function readError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function badRequest(code) {
  throw readError(code, 400);
}

function requiredTable(value) {
  const table = text(value);
  if (!table) badRequest("missing_read_table");
  if (!SAFE_NAME_PATTERN.test(table) || !ALLOWED_READ_TABLES.has(table)) badRequest("invalid_read_table");
  return table;
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function splitComma(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSelect(select) {
  const raw = text(select);
  if (!raw || raw === "*") return "*";
  const columns = splitComma(raw);
  if (!columns.length || columns.includes("*")) return "*";
  for (const column of columns) {
    if (!SAFE_NAME_PATTERN.test(column)) badRequest("invalid_read_select");
  }
  return columns.map(quoteIdentifier).join(", ");
}

function parseOrder(order) {
  const raw = text(order);
  if (!raw) return "";
  const terms = splitComma(raw);
  if (!terms.length) return "";
  return terms.map((term) => {
    const [columnRaw, directionRaw = "asc"] = term.split(".");
    const column = text(columnRaw);
    const direction = text(directionRaw).toLowerCase();
    if (!SAFE_NAME_PATTERN.test(column) || !new Set(["asc", "desc"]).has(direction)) {
      badRequest("invalid_read_order");
    }
    return `${quoteIdentifier(column)} ${direction.toUpperCase()}`;
  }).join(", ");
}

function parseFilterExpression(key) {
  const raw = text(key);
  if (SAFE_NAME_PATTERN.test(raw)) return quoteIdentifier(raw);

  const tokens = raw.split(/(->>|->)/).filter(Boolean);
  if (tokens.length < 3 || tokens.length % 2 === 0) badRequest("invalid_read_filter_key");

  const root = tokens[0];
  if (!SAFE_NAME_PATTERN.test(root)) badRequest("invalid_read_filter_key");

  let expression = quoteIdentifier(root);
  for (let index = 1; index < tokens.length; index += 2) {
    const operator = tokens[index];
    const segment = tokens[index + 1];
    if (!segment || !new Set(["->", "->>"]).has(operator) || !SAFE_NAME_PATTERN.test(segment)) {
      badRequest("invalid_read_filter_key");
    }
    expression = `${expression}${operator}'${segment}'`;
  }
  return expression;
}

function normalizeFilterValue(value) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseFilterClause(key, value, params) {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return null;

  const expression = parseFilterExpression(key);
  const prefix = RAW_FILTER_PREFIXES.find((item) => normalized.startsWith(item));
  if (!prefix) {
    params.push(normalized);
    return `${expression} = $${params.length}`;
  }

  const operand = normalized.slice(prefix.length);
  if (prefix === "is.") {
    const next = text(operand).toLowerCase();
    if (next === "null") return `${expression} IS NULL`;
    if (next === "not.null") return `${expression} IS NOT NULL`;
    if (next === "true") return `${expression} IS TRUE`;
    if (next === "false") return `${expression} IS FALSE`;
    badRequest("invalid_read_filter_value");
  }

  if (prefix === "in.") {
    const rawItems = text(operand);
    const items = rawItems.startsWith("(") && rawItems.endsWith(")")
      ? rawItems.slice(1, -1)
      : rawItems;
    const values = splitComma(items);
    if (!values.length) return null;
    const firstIndex = params.length + 1;
    params.push(...values);
    const placeholders = values.map((_value, index) => `$${firstIndex + index}`);
    return `${expression} IN (${placeholders.join(", ")})`;
  }

  if (!text(operand)) badRequest("invalid_read_filter_value");
  params.push(operand);
  const placeholder = `$${params.length}`;
  if (prefix === "eq.") return `${expression} = ${placeholder}`;
  if (prefix === "neq.") return `${expression} <> ${placeholder}`;
  if (prefix === "gte.") return `${expression} >= ${placeholder}`;
  if (prefix === "lte.") return `${expression} <= ${placeholder}`;
  if (prefix === "lt.") return `${expression} < ${placeholder}`;
  if (prefix === "gt.") return `${expression} > ${placeholder}`;
  if (prefix === "like.") return `${expression} LIKE ${placeholder}`;
  if (prefix === "ilike.") return `${expression} ILIKE ${placeholder}`;
  badRequest("invalid_read_filter_value");
}

function normalizeLimit(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) badRequest("invalid_read_limit");
  return Math.min(Math.trunc(parsed), MAX_READ_LIMIT);
}

function normalizeOffset(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) badRequest("invalid_read_offset");
  return Math.trunc(parsed);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw readError("request_body_too_large", 413);
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    badRequest("invalid_json_body");
  }
}

function installationScopedFilters(table, filters, context) {
  const next = { ...(filters || {}) };
  if (!INSTALLATION_SCOPED_READ_TABLES.has(table)) return next;

  const currentInstallationId = text(context?.installation?.id);
  if (!currentInstallationId) throw readError("installation_context_required", 500);
  next.installation_id = `eq.${currentInstallationId}`;
  return next;
}

function buildReadQuery(table, request, context) {
  const sqlParts = [`FROM ${quoteIdentifier(table)}`];
  const params = [];
  const filters = Object.entries(installationScopedFilters(table, request.filters, context))
    .map(([key, value]) => parseFilterClause(key, value, params))
    .filter(Boolean);

  if (filters.length) sqlParts.push(`WHERE ${filters.join(" AND ")}`);

  if (request.count === true) {
    return {
      sql: `SELECT COUNT(*)::integer AS count ${sqlParts.join(" ")}`,
      params
    };
  }

  const select = parseSelect(request.select);
  const order = parseOrder(request.order);
  const limit = normalizeLimit(request.limit);
  const offset = normalizeOffset(request.offset);
  const queryParts = [`SELECT ${select}`, ...sqlParts];

  if (order) queryParts.push(`ORDER BY ${order}`);
  if (limit != null) {
    params.push(limit);
    queryParts.push(`LIMIT $${params.length}`);
  }
  if (offset != null) {
    params.push(offset);
    queryParts.push(`OFFSET $${params.length}`);
  }

  return {
    sql: queryParts.join(" "),
    params
  };
}

export async function handleReadApi(req, url, context, config, { persistence } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "POST" || url.pathname !== "/api/read") return null;
  if (!persistence || typeof persistence.assertReady !== "function" || typeof persistence.withTransaction !== "function") {
    throw readError("provider_unavailable", 503);
  }

  const body = await readJsonBody(req);
  const table = requiredTable(body.table);
  const requiredPermission = READ_PERMISSION_BY_TABLE.get(table);
  if (requiredPermission) requirePermission(context, requiredPermission);
  const query = buildReadQuery(table, body, context);

  await persistence.assertReady();
  const result = await persistence.withTransaction(async (client) => {
    const output = await client.query(query.sql, query.params);
    return output.rows || [];
  });

  if (body.count === true) {
    const count = Number(result?.[0]?.count || 0);
    return {
      statusCode: 200,
      payload: {
        data: Number.isFinite(count) ? count : 0,
        receivedAt: new Date().toISOString()
      }
    };
  }

  return {
    statusCode: 200,
    payload: {
      data: Array.isArray(result) ? result : [],
      receivedAt: new Date().toISOString()
    }
  };
}
