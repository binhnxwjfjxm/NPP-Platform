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

function splitComma(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSelect(select) {
  const raw = text(select);
  if (!raw || raw === "*") return null;
  const columns = splitComma(raw);
  if (!columns.length || columns.includes("*")) return null;
  for (const column of columns) {
    if (!SAFE_NAME_PATTERN.test(column)) badRequest("invalid_read_select");
  }
  return columns;
}

function parsePath(key) {
  const raw = text(key);
  if (SAFE_NAME_PATTERN.test(raw)) return [raw];

  const tokens = raw.split(/(->>|->)/).filter(Boolean);
  if (tokens.length < 3 || tokens.length % 2 === 0) badRequest("invalid_read_filter_key");

  const parts = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const segment = tokens[index];
    if (!SAFE_NAME_PATTERN.test(segment)) badRequest("invalid_read_filter_key");
    parts.push(segment);
    if (index + 1 < tokens.length && !new Set(["->", "->>"]).has(tokens[index + 1])) {
      badRequest("invalid_read_filter_key");
    }
  }
  return parts;
}

function jsonPathLiteral(parts) {
  return `'{${parts.join(",")}}'`;
}

function jsonTextExpression(parts) {
  return `row_data #>> ${jsonPathLiteral(parts)}`;
}

function jsonValueExpression(parts) {
  return `row_data #> ${jsonPathLiteral(parts)}`;
}

function parseOrder(order) {
  const raw = text(order);
  if (!raw) return [];
  const terms = splitComma(raw);
  return terms.map((term) => {
    const [columnRaw, directionRaw = "asc"] = term.split(".");
    const column = text(columnRaw);
    const direction = text(directionRaw).toLowerCase();
    if (!SAFE_NAME_PATTERN.test(column) || !new Set(["asc", "desc"]).has(direction)) {
      badRequest("invalid_read_order");
    }
    return { column, direction };
  });
}

function normalizeFilterValue(value) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseFilterClause(key, value, params) {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return null;

  const parts = parsePath(key);
  const textExpression = jsonTextExpression(parts);
  const valueExpression = jsonValueExpression(parts);
  const prefix = RAW_FILTER_PREFIXES.find((item) => normalized.startsWith(item));
  if (!prefix) {
    params.push(normalized);
    return `${textExpression} = $${params.length}`;
  }

  const operand = normalized.slice(prefix.length);
  if (prefix === "is.") {
    const next = text(operand).toLowerCase();
    if (next === "null") return `(${valueExpression} IS NULL OR ${valueExpression} = 'null'::jsonb)`;
    if (next === "not.null") return `(${valueExpression} IS NOT NULL AND ${valueExpression} <> 'null'::jsonb)`;
    if (next === "true") return `${textExpression} = 'true'`;
    if (next === "false") return `${textExpression} = 'false'`;
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
    return `${textExpression} IN (${placeholders.join(", ")})`;
  }

  if (!text(operand)) badRequest("invalid_read_filter_value");
  params.push(operand);
  const placeholder = `$${params.length}`;
  if (prefix === "eq.") return `${textExpression} = ${placeholder}`;
  if (prefix === "neq.") return `${textExpression} <> ${placeholder}`;
  if (prefix === "gte.") return `${textExpression} >= ${placeholder}`;
  if (prefix === "lte.") return `${textExpression} <= ${placeholder}`;
  if (prefix === "lt.") return `${textExpression} < ${placeholder}`;
  if (prefix === "gt.") return `${textExpression} > ${placeholder}`;
  if (prefix === "like.") return `${textExpression} LIKE ${placeholder}`;
  if (prefix === "ilike.") return `${textExpression} ILIKE ${placeholder}`;
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

function buildReadQuery(table, request, installationId) {
  const params = [installationId, table];
  const where = ["installation_id = $1", "table_name = $2"];
  const filters = Object.entries(request.filters || {})
    .map(([key, value]) => parseFilterClause(key, value, params))
    .filter(Boolean);
  where.push(...filters);

  if (request.count === true) {
    return {
      sql: `SELECT COUNT(*)::integer AS count FROM mcp.legacy_read_rows WHERE ${where.join(" AND ")}`,
      params,
      columns: null
    };
  }

  const columns = parseSelect(request.select);
  const order = parseOrder(request.order);
  const limit = normalizeLimit(request.limit);
  const offset = normalizeOffset(request.offset);
  const queryParts = [
    "SELECT row_key, row_data",
    "FROM mcp.legacy_read_rows",
    `WHERE ${where.join(" AND ")}`
  ];

  if (order.length) {
    queryParts.push(`ORDER BY ${order.map(({ column, direction }) => (
      `${jsonTextExpression([column])} ${direction.toUpperCase()} NULLS LAST`
    )).join(", ")}`);
  } else {
    queryParts.push("ORDER BY row_key ASC");
  }
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
    params,
    columns
  };
}

function projectRow(value, columns) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (!columns) return row;
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}

export async function handleReadApi(req, url, context, config, { persistence } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  if (method !== "POST" || url.pathname !== "/api/read") return null;
  if (!persistence || typeof persistence.assertReady !== "function" || typeof persistence.withTransaction !== "function") {
    throw readError("provider_unavailable", 503);
  }

  const installationId = text(context?.installation?.id);
  if (!installationId) throw readError("missing_installation_context", 500);

  const body = await readJsonBody(req);
  const table = requiredTable(body.table);
  const query = buildReadQuery(table, body, installationId);

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
      data: Array.isArray(result)
        ? result.map((row) => projectRow(row?.row_data, query.columns))
        : [],
      receivedAt: new Date().toISOString()
    }
  };
}
