const SAFE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const RAW_FILTER_PREFIXES = ["eq.", "neq.", "gte.", "lte.", "lt.", "gt.", "ilike.", "like.", "is.", "in."];

function text(value) {
  return String(value ?? "").trim();
}

function splitComma(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readPathValue(row, key) {
  const raw = text(key);
  if (SAFE_NAME_PATTERN.test(raw)) return row?.[raw];

  const tokens = raw.split(/(->>|->)/).filter(Boolean);
  if (tokens.length < 3 || tokens.length % 2 === 0) return undefined;
  if (!SAFE_NAME_PATTERN.test(tokens[0])) return undefined;

  let current = row?.[tokens[0]];
  for (let index = 1; index < tokens.length; index += 2) {
    const segment = tokens[index + 1];
    if (!segment || !SAFE_NAME_PATTERN.test(segment) || current == null || typeof current !== "object") {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function comparable(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const textValue = text(value);
  if (!textValue) return "";
  const numeric = Number(textValue);
  return Number.isFinite(numeric) && String(numeric) === textValue ? numeric : textValue;
}

function compareValues(left, right) {
  const normalizedLeft = comparable(left);
  const normalizedRight = comparable(right);
  if (normalizedLeft == null && normalizedRight == null) return 0;
  if (normalizedLeft == null) return -1;
  if (normalizedRight == null) return 1;
  if (typeof normalizedLeft === "number" && typeof normalizedRight === "number") {
    return normalizedLeft - normalizedRight;
  }
  return text(normalizedLeft).localeCompare(text(normalizedRight));
}

function matchesLike(value, pattern, caseInsensitive) {
  const raw = text(pattern);
  if (!raw) return text(value) === "";
  const escaped = raw
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  const flags = caseInsensitive ? "i" : "";
  return new RegExp(`^${escaped}$`, flags).test(text(value));
}

function matchesFilter(row, key, rawValue) {
  if (rawValue == null || rawValue === "") return true;
  const value = String(rawValue).trim();
  if (!value) return true;
  const prefix = RAW_FILTER_PREFIXES.find((item) => value.startsWith(item));
  if (!prefix) return false;

  const operand = value.slice(prefix.length);
  const actual = readPathValue(row, key);
  if (prefix === "is.") {
    const next = text(operand).toLowerCase();
    if (next === "null") return actual == null || actual === "";
    if (next === "not.null") return !(actual == null || actual === "");
    if (next === "true") return Boolean(actual) === true;
    if (next === "false") return Boolean(actual) === false;
    return false;
  }

  if (prefix === "in.") {
    const rawItems = text(operand);
    const items = rawItems.startsWith("(") && rawItems.endsWith(")")
      ? rawItems.slice(1, -1)
      : rawItems;
    const choices = splitComma(items);
    if (!choices.length) return true;
    return choices.some((item) => text(actual) === item);
  }

  if (prefix === "like.") return matchesLike(actual, operand, false);
  if (prefix === "ilike.") return matchesLike(actual, operand, true);
  if (prefix === "eq.") return text(actual) === text(operand);
  if (prefix === "neq.") return text(actual) !== text(operand);

  const left = comparable(actual);
  const right = comparable(operand);
  if (left == null || right == null) return false;
  const comparison = compareValues(left, right);
  if (prefix === "gte.") return comparison >= 0;
  if (prefix === "lte.") return comparison <= 0;
  if (prefix === "lt.") return comparison < 0;
  if (prefix === "gt.") return comparison > 0;
  return false;
}

function parseOrder(order) {
  const raw = text(order);
  if (!raw) return [];
  return splitComma(raw).map((term) => {
    const [columnRaw, directionRaw = "asc"] = term.split(".");
    const column = text(columnRaw);
    const direction = text(directionRaw).toLowerCase();
    return {
      column,
      direction: direction === "desc" ? "desc" : "asc"
    };
  }).filter((term) => term.column);
}

function sortRows(rows, order) {
  const terms = parseOrder(order);
  if (!terms.length) return rows;
  return [...rows].sort((left, right) => {
    for (const term of terms) {
      const comparison = compareValues(readPathValue(left, term.column), readPathValue(right, term.column));
      if (comparison !== 0) return term.direction === "desc" ? -comparison : comparison;
    }
    return 0;
  });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export async function handleMockReadRequest(request, url, dataByTable, { failReads = false } = {}) {
  if (request.method !== "POST" || url.pathname !== "/api/read") return null;
  if (failReads) return { status: 503, body: { message: "fixture_read_failed" } };

  const body = await readBody(request);
  const table = text(body.table);
  const source = Array.isArray(dataByTable?.[table]) ? dataByTable[table] : null;
  if (!table || !source) {
    return { status: 404, body: { message: `unknown_table:${table}` } };
  }

  const filtered = source.filter((row) =>
    Object.entries(body.filters || {}).every(([key, value]) => matchesFilter(row, key, value))
  );
  const ordered = sortRows(filtered, body.order);
  const offset = Math.max(0, Number(body.offset || 0) || 0);
  const limit = body.limit == null ? null : Math.max(0, Number(body.limit) || 0);
  const paged = limit == null ? ordered.slice(offset) : ordered.slice(offset, offset + limit);

  if (body.count === true) {
    return { status: 200, body: filtered.length };
  }

  return { status: 200, body: paged };
}
