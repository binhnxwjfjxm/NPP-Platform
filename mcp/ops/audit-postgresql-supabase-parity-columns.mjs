import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const files = [
  "mcp/apps/backend/foundation/migrations/sql/001_mcp_write_foundation.sql",
  "mcp/apps/backend/foundation/migrations/sql/002_mcp_domain_read_models.sql",
  "mcp/apps/backend/foundation/migrations/sql/003_mcp_supabase_contract_parity.sql"
];
const sql = files.map((file) => readFileSync(resolve(root, file), "utf8")).join("\n\n");

function statementEnd(text, start) {
  let depth = 0;
  let quote = null;
  let dollar = null;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (dollar) {
      if (text.startsWith(dollar, i)) {
        i += dollar.length - 1;
        dollar = null;
      }
      continue;
    }
    if (quote) {
      if (char === quote && text[i + 1] === quote) i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    const dollarMatch = text.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
    if (dollarMatch) {
      dollar = dollarMatch[0];
      i += dollar.length - 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (text.startsWith("--", i)) {
      const newline = text.indexOf("\n", i + 2);
      if (newline === -1) return text.length;
      i = newline;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      if (close === -1) throw new Error("unterminated_comment");
      i = close + 1;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === ";" && depth === 0) return i + 1;
  }
  return text.length;
}

function matchingParen(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i + 1] === quote) i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("unmatched_parenthesis");
}

function splitTopLevel(text) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote && text[i + 1] === quote) i += 1;
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
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const tables = new Map();
function columnsFor(table) {
  if (!tables.has(table)) tables.set(table, new Set());
  return tables.get(table);
}

const createPattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?mcp\.([a-z0-9_]+)\s*\(/gi;
let match;
while ((match = createPattern.exec(sql))) {
  const table = match[1].toLowerCase();
  const open = sql.indexOf("(", match.index);
  const close = matchingParen(sql, open);
  for (const raw of splitTopLevel(sql.slice(open + 1, close))) {
    const item = raw.trim();
    if (!item || /^(?:constraint|primary|unique|check|foreign|exclude)\b/i.test(item)) continue;
    const column = item.match(/^"?([a-z_][a-z0-9_]*)"?\s+/i)?.[1]?.toLowerCase();
    if (column) columnsFor(table).add(column);
  }
  createPattern.lastIndex = close + 1;
}

const alterPattern = /alter\s+table\s+mcp\.([a-z0-9_]+)\b/gi;
while ((match = alterPattern.exec(sql))) {
  const table = match[1].toLowerCase();
  const end = statementEnd(sql, match.index);
  const statement = sql.slice(match.index, end);
  const addPattern = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  let add;
  while ((add = addPattern.exec(statement))) columnsFor(table).add(add[1].toLowerCase());
  alterPattern.lastIndex = end;
}

const references = new Map();
function addReference(table, column, kind) {
  const key = `${table}.${column}`;
  if (!references.has(key)) references.set(key, new Set());
  references.get(key).add(kind);
}

const insertPattern = /insert\s+into\s+mcp\.([a-z0-9_]+)\s*\(/gi;
while ((match = insertPattern.exec(sql))) {
  const table = match[1].toLowerCase();
  const open = sql.indexOf("(", match.index);
  const close = matchingParen(sql, open);
  for (const raw of splitTopLevel(sql.slice(open + 1, close))) {
    const column = raw.trim().replace(/^"|"$/g, "").toLowerCase();
    if (/^[a-z_][a-z0-9_]*$/.test(column)) addReference(table, column, "insert");
  }
  insertPattern.lastIndex = close + 1;
}

const updatePattern = /update\s+mcp\.([a-z0-9_]+)(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s+set\s+/gi;
while ((match = updatePattern.exec(sql))) {
  const table = match[1].toLowerCase();
  const end = statementEnd(sql, match.index);
  let body = sql.slice(updatePattern.lastIndex, end);
  const stop = body.search(/\bwhere\b|\breturning\b|;/i);
  if (stop >= 0) body = body.slice(0, stop);
  for (const assignment of splitTopLevel(body)) {
    const column = assignment.match(/^\s*"?([a-z_][a-z0-9_]*)"?\s*=/i)?.[1]?.toLowerCase();
    if (column) addReference(table, column, "update");
  }
  updatePattern.lastIndex = end;
}

const missing = [];
for (const [key, kinds] of references) {
  const [table, column] = key.split(".");
  if (!tables.get(table)?.has(column)) missing.push({ table, column, kinds: [...kinds].sort() });
}
missing.sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));

console.log(JSON.stringify({ tables: tables.size, references: references.size, missing }, null, 2));
if (missing.length) process.exit(1);
