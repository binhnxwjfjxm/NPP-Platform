import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "mcp/ops/generate-postgresql-supabase-parity.mjs");
let source = readFileSync(target, "utf8");
const required = [
  "mcp_add_route_customer",
  "mcp_claim_archive_intent",
  "mcp_finish_archive_intent",
  "mcp_delete_route_customer_hard",
  "mcp_delete_route_hard"
];

const additions = required.filter((name) => !source.includes(`  "${name}"`));
if (additions.length) {
  const anchor = '  "mcp_search_products"\n]);';
  if (!source.includes(anchor)) throw new Error("required_function_anchor_missing");
  source = source.replace(
    anchor,
    `  "mcp_search_products",\n${additions.map((name) => `  "${name}"`).join(",\n")}\n]);`
  );
}
writeFileSync(target, source, "utf8");
console.log(JSON.stringify({ addedFunctions: additions }));
