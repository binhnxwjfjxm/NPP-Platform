import { readFileSync } from "node:fs";
import { createPostgresqlWriteTransaction } from "./postgresql-write-repository.js";
import { executeWriteCommand } from "./write-command.js";

const MIGRATION_SQL = readFileSync(
  new URL("./migrations/sql/003_mcp_supabase_contract_parity.sql", import.meta.url),
  "utf8"
);

const FUNCTION_PATTERN = /^[a-z_][a-z0-9_]{2,126}$/;
const PARAMETER_PATTERN = /^[a-z_][a-z0-9_]{1,126}$/;
const COLUMN_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const SAFE_TYPES = new Set([
  "bigint",
  "boolean",
  "date",
  "double precision",
  "integer",
  "json",
  "jsonb",
  "numeric",
  "smallint",
  "text",
  "text[]",
  "timestamp with time zone",
  "timestamp without time zone",
  "timestamptz",
  "uuid"
]);
const READ_ONLY_FUNCTIONS = new Set(["mcp_get_product_variants", "mcp_search_products"]);
const REST_TABLES = Object.freeze({
  order_items: Object.freeze({ installationScoped: true }),
  mcp_outlet_media: Object.freeze({ installationScoped: true }),
  mcp_route_customers: Object.freeze({ installationScoped: true }),
  mcp_routes: Object.freeze({ installationScoped: true }),
  mcp_report_templates: Object.freeze({ installationScoped: false })
});

function providerError(code, statusCode = 500) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function matchingParen(text, open) {
  let depth = 0;
  let quote = null;
  let dollar = null;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (dollar) {
      if (text.startsWith(dollar, index)) {
        index += dollar.length - 1;
        dollar = null;
      }
      continue;
    }
    if (quote) {
      if (char === quote && text[index + 1] === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    const dollarMatch = text.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
    if (dollarMatch) {
      dollar = dollarMatch[0];
      index += dollar.length - 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw providerError("postgresql_function_catalog_invalid");
}

function splitTopLevel(text) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index + 1] === quote) index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function parameterDefinition(raw) {
  const normalized = raw.trim().replace(/^IN\s+/i, "");
  if (!normalized) return null;
  const match = normalized.match(/^"?([a-z_][a-z0-9_]*)"?\s+([\s\S]+)$/i);
  if (!match) throw providerError("postgresql_function_parameter_invalid");
  const name = match[1].toLowerCase();
  let type = match[2]
    .replace(/\s+DEFAULT\s+[\s\S]*$/i, "")
    .replace(/\s*=\s*[\s\S]*$/i, "")
    .trim()
    .toLowerCase()
    .replace(/^pg_catalog\./, "");
  if (type === "timestamp") type = "timestamp without time zone";
  if (!PARAMETER_PATTERN.test(name) || !SAFE_TYPES.has(type)) {
    throw providerError(`postgresql_function_parameter_forbidden:${name}:${type}`);
  }
  return Object.freeze({ name, type });
}

function parseFunctionCatalog(sql) {
  const catalog = new Map();
  const pattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+mcp\.([a-z0-9_]+)\s*\(/gi;
  let match;
  while ((match = pattern.exec(sql))) {
    const name = match[1].toLowerCase();
    if (!FUNCTION_PATTERN.test(name)) throw providerError("postgresql_function_name_invalid");
    const open = sql.indexOf("(", match.index);
    const close = matchingParen(sql, open);
    const parameters = splitTopLevel(sql.slice(open + 1, close))
      .map(parameterDefinition)
      .filter(Boolean);
    const tail = sql.slice(close + 1, Math.min(sql.length, close + 1200));
    const returnMatch = tail.match(/^\s*RETURNS\s+([\s\S]+?)\s+LANGUAGE\s+/i);
    if (!returnMatch) throw providerError(`postgresql_function_return_invalid:${name}`);
    const returnType = returnMatch[1].trim().toLowerCase();
    catalog.set(name, Object.freeze({
      name,
      parameters: Object.freeze(parameters),
      returnsRows: /^(?:setof\b|table\s*\()/i.test(returnType)
    }));
    pattern.lastIndex = close + 1;
  }
  return catalog;
}

export const POSTGRESQL_LEGACY_FUNCTION_CATALOG = parseFunctionCatalog(MIGRATION_SQL);

function targetFunction(rpcName) {
  const name = String(rpcName || "").trim().toLowerCase();
  if (!FUNCTION_PATTERN.test(name) || !name.startsWith("mcp_")) {
    throw providerError("legacy_rpc_name_forbidden", 400);
  }
  return name.startsWith("mcp_idempotent_")
    ? `mcp_${name.slice("mcp_idempotent_".length)}`
    : name;
}

function normalizeValue(value, type) {
  if (value === undefined) return null;
  if (type === "json" || type === "jsonb") return JSON.stringify(value ?? null);
  return value;
}

function functionCall(definition, args) {
  const values = [];
  const named = [];
  for (const parameter of definition.parameters) {
    if (!Object.prototype.hasOwnProperty.call(args, parameter.name)) continue;
    values.push(normalizeValue(args[parameter.name], parameter.type));
    named.push(`${parameter.name} => $${values.length}::${parameter.type}`);
  }
  const expression = `mcp.${definition.name}(${named.join(", ")})`;
  return Object.freeze({
    text: definition.returnsRows
      ? `SELECT * FROM ${expression}`
      : `SELECT to_jsonb(${expression}) AS data`,
    values,
    returnsRows: definition.returnsRows
  });
}

function normalizeDatabaseError(error) {
  if (!error || typeof error !== "object") return error;
  if (!error.providerMessage) error.providerMessage = String(error.message || "postgresql_function_failed");
  if (!error.providerDetails && error.detail) error.providerDetails = String(error.detail);
  return error;
}

function repositoryFactory(catalog) {
  return (client) => {
    const functions = {};
    for (const definition of catalog.values()) {
      functions[definition.name] = async (args = {}, context = null) => {
        try {
          if (context?.installation?.id) {
            await client.query("SELECT set_config('app.installation_id', $1, true)", [context.installation.id]);
          }
          const call = functionCall(definition, args);
          const result = await client.query(call.text, call.values);
          return call.returnsRows ? (result.rows || []) : (result.rows?.[0]?.data ?? null);
        } catch (error) {
          throw normalizeDatabaseError(error);
        }
      };
    }
    return Object.freeze({ legacyFunctions: Object.freeze(functions) });
  };
}

function operationDomain(functionName) {
  if (/outlet_media|storage_delete|archive_intent|delete_route/.test(functionName)) return "media";
  if (/report_setting|session_report|report_from|report_template/.test(functionName)) return "reports";
  if (/order/.test(functionName)) return "orders";
  if (/test|field_check/.test(functionName)) return "field";
  if (/session|followup|visit/.test(functionName)) return "sessions";
  if (/route|customer/.test(functionName)) return "routes";
  return "operations";
}

function operationName(functionName) {
  return functionName.replace(/^mcp_/, "").replace(/_/g, ".");
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function aggregateId(result, args, context) {
  const source = object(result);
  const candidates = [
    source.id,
    source.routeId,
    source.route_id,
    source.routeCustomerId,
    source.route_customer_id,
    source.sessionId,
    source.session_id,
    source.sessionCustomerId,
    source.session_customer_id,
    source.orderId,
    source.order_id,
    source.reportId,
    source.report_id,
    source.testId,
    source.test_id,
    args.p_route_id,
    args.p_route_customer_id,
    args.p_session_id,
    args.p_session_customer_id,
    args.p_order_id,
    args.p_media_id,
    args.p_intent_id
  ];
  const found = candidates.map((value) => String(value ?? "").trim()).find(Boolean);
  return found || `request:${context.requestId}`;
}

function stableCommandArgs(args) {
  const payload = { ...object(args) };
  delete payload.p_context;
  return payload;
}

function writeContext(context, rpcName) {
  if (context.idempotencyKey || rpcName.startsWith("mcp_idempotent_")) return context;
  return Object.freeze({ ...context, idempotencyKey: `compat:${context.requestId}`.slice(0, 191) });
}

function restColumnList(value) {
  const raw = String(value || "*").trim();
  if (raw === "*") return "*";
  const columns = raw.split(",").map((item) => item.trim());
  if (!columns.length || columns.some((column) => !COLUMN_PATTERN.test(column))) {
    throw providerError("legacy_rest_select_forbidden", 400);
  }
  return columns.map((column) => `"${column}"`).join(", ");
}

function boundedInteger(value, fallback, max) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function restQuery(resource, context) {
  const url = new URL(String(resource || ""), "http://mcp.local/");
  const table = url.pathname.replace(/^\/+/, "").trim().toLowerCase();
  const tableConfig = REST_TABLES[table];
  if (!tableConfig || !COLUMN_PATTERN.test(table)) throw providerError("legacy_rest_table_forbidden", 400);
  const values = [];
  const predicates = [];
  for (const [key, value] of url.searchParams) {
    if (new Set(["select", "order", "limit", "offset"]).has(key)) continue;
    if (!COLUMN_PATTERN.test(key) || !String(value).startsWith("eq.")) {
      throw providerError("legacy_rest_filter_forbidden", 400);
    }
    const decoded = String(value).slice(3);
    if (decoded === "null") predicates.push(`"${key}" IS NULL`);
    else {
      values.push(decoded);
      predicates.push(`"${key}" = $${values.length}`);
    }
  }
  if (tableConfig.installationScoped && context?.installation?.id && !url.searchParams.has("installation_id")) {
    values.push(context.installation.id);
    predicates.push(`("installation_id" = $${values.length} OR "installation_id" IS NULL)`);
  }
  const orderValue = String(url.searchParams.get("order") || "").trim();
  const order = orderValue
    ? orderValue.split(",").map((part) => {
      const [column, direction = "asc"] = part.trim().split(".");
      if (!COLUMN_PATTERN.test(column) || !new Set(["asc", "desc"]).has(direction.toLowerCase())) {
        throw providerError("legacy_rest_order_forbidden", 400);
      }
      return `"${column}" ${direction.toUpperCase()}`;
    }).join(", ")
    : "";
  const limit = boundedInteger(url.searchParams.get("limit"), 100, 1000);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 1000000);
  const text = [
    `SELECT ${restColumnList(url.searchParams.get("select"))} FROM mcp."${table}"`,
    predicates.length ? `WHERE ${predicates.join(" AND ")}` : "",
    order ? `ORDER BY ${order}` : "",
    `LIMIT ${limit} OFFSET ${offset}`
  ].filter(Boolean).join(" ");
  return Object.freeze({ text, values });
}

export function createPostgresqlLegacyProvider(config, persistence) {
  if (config.persistence.provider !== "postgresql") throw providerError("postgresql_provider_required");
  const catalog = POSTGRESQL_LEGACY_FUNCTION_CATALOG;
  const transaction = createPostgresqlWriteTransaction(persistence, {
    domainRepositoryFactory: repositoryFactory(catalog)
  });

  return Object.freeze({
    bindRequest(context) {
      return Object.freeze({ ...config, foundationProviderPort: this, foundationRequestContext: context });
    },

    async rpc(rpcName, args = {}, context) {
      const target = targetFunction(rpcName);
      const definition = catalog.get(target);
      if (!definition) throw providerError(`legacy_rpc_unmapped:${rpcName}`, 503);
      if (READ_ONLY_FUNCTIONS.has(target)) {
        return persistence.withTransaction(async (client) => {
          const repositories = repositoryFactory(catalog)(client);
          return repositories.legacyFunctions[target](args, context);
        });
      }

      const domain = operationDomain(target);
      const activeContext = writeContext(context, rpcName);
      return executeWriteCommand({
        context: activeContext,
        commandName: `mcp.${operationName(target)}`,
        permission: `mcp.${domain}.write`,
        scope: `mcp:${domain}`,
        payload: { rpcName, args: stableCommandArgs(args) },
        aggregate: (result) => ({ type: domain, id: aggregateId(result, args, activeContext), version: 1 }),
        eventType: `mcp.${domain}.${operationName(target)}`,
        source: "mcp-postgresql-compatibility",
        transaction,
        mutate: async (tx) => tx.repositories.legacyFunctions[target](args, activeContext),
        eventPayload: (result) => ({ rpcName, result })
      });
    },

    async rest(resource, options = {}, context) {
      const method = String(options.method || "GET").toUpperCase();
      if (method !== "GET") throw providerError("legacy_rest_mutation_forbidden", 405);
      const query = restQuery(resource, context);
      return persistence.withTransaction(async (client) => {
        const result = await client.query(query.text, query.values);
        return result.rows || [];
      });
    }
  });
}
