import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "mcp/apps/backend/foundation/postgresql-legacy-provider.js");
let source = readFileSync(target, "utf8");

const helper = `function stableCommandArgs(args) {
  const payload = { ...object(args) };
  delete payload.p_context;
  return payload;
}

`;
if (!source.includes("function stableCommandArgs(args)")) {
  const anchor = "function writeContext(context, rpcName) {";
  if (!source.includes(anchor)) throw new Error("stable_command_args_anchor_missing");
  source = source.replace(anchor, helper + anchor);
}

const before = "        payload: { rpcName, args },";
const after = "        payload: { rpcName, args: stableCommandArgs(args) },";
if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error("stable_command_payload_anchor_missing");
  source = source.replace(before, after);
}

writeFileSync(target, source, "utf8");
console.log("patched stable legacy PostgreSQL command fingerprint");
