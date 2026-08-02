import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const foundation = resolve(root, "mcp/apps/backend/foundation");
const migration = readFileSync(
  resolve(root, "mcp/apps/backend/foundation/migrations/sql/003_mcp_supabase_contract_parity.sql"),
  "utf8"
);

const rpcNames = new Set();
for (const file of readdirSync(foundation).filter((name) => name.endsWith(".js"))) {
  const text = readFileSync(resolve(foundation, file), "utf8");
  for (const match of text.matchAll(/supabaseRpc\s*\(\s*config\s*,\s*["'`]([^"'`]+)["'`]/g)) {
    rpcNames.add(match[1]);
  }
}

function target(name) {
  return name.startsWith("mcp_idempotent_")
    ? `mcp_${name.slice("mcp_idempotent_".length)}`
    : name;
}

const functions = new Set(
  [...migration.matchAll(/create\s+(?:or\s+replace\s+)?function\s+mcp\.([a-z0-9_]+)\s*\(/gi)]
    .map((match) => match[1].toLowerCase())
);
const mappings = [...rpcNames].sort().map((rpc) => ({ rpc, target: target(rpc) }));
const missing = mappings.filter(({ target: functionName }) => !functions.has(functionName));
console.log(JSON.stringify({ mappings, functionCount: functions.size, missing }, null, 2));
console.log(`MISSING_FUNCTIONS=${missing.map(({ target: functionName }) => functionName).join(",")}`);
if (missing.length) process.exit(1);
