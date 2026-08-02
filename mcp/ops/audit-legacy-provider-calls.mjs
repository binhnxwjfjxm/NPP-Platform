import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = resolve(root, "mcp/apps/backend/foundation");
const files = readdirSync(dir).filter((name) => name.endsWith(".js")).sort();
const rpc = [];
const rest = [];

for (const file of files) {
  const text = readFileSync(resolve(dir, file), "utf8");
  for (const match of text.matchAll(/supabaseRpc\s*\(\s*config\s*,\s*["'`]([^"'`]+)["'`]/g)) {
    rpc.push({ file, name: match[1] });
  }
  for (const match of text.matchAll(/supabaseRest\s*\(\s*config\s*,\s*([\s\S]{0,240}?)(?=,\s*\{)/g)) {
    const expression = match[1].replace(/\s+/g, " ").trim();
    rest.push({ file, expression });
  }
}

rpc.sort((a, b) => `${a.name}:${a.file}`.localeCompare(`${b.name}:${b.file}`));
rest.sort((a, b) => `${a.file}:${a.expression}`.localeCompare(`${b.file}:${b.expression}`));
console.log(JSON.stringify({ rpc, rest }, null, 2));
console.log(`RPC_NAMES=${[...new Set(rpc.map((item) => item.name))].join(",")}`);
console.log(`REST_CALLS=${rest.map((item) => `${item.file}:${item.expression}`).join(" | ")}`);
