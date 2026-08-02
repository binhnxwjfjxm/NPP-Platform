import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "mcp/ops/generate-postgresql-supabase-parity.mjs");
let source = readFileSync(target, "utf8");

const replacements = [
  [
    "    id, distributor_id, route_name, area, weekday, active, note,\n    sync_status, raw_payload, created_at, updated_at",
    "    id, installation_id, distributor_id, route_name, area, weekday, active, note,\n    sync_status, raw_payload, created_at, updated_at"
  ],
  [
    "    'route_' || replace(gen_random_uuid()::text, '-', ''),\n    NULLIF(btrim(COALESCE(p_distributor_id, '')), ''),",
    "    'route_' || replace(gen_random_uuid()::text, '-', ''),\n    NULLIF(current_setting('app.installation_id', true), ''),\n    NULLIF(btrim(COALESCE(p_distributor_id, '')), ''),"
  ],
  [
    "  WHERE id = p_route_id\n  RETURNING * INTO v_route;",
    "  WHERE id = p_route_id\n    AND (installation_id = NULLIF(current_setting('app.installation_id', true), '') OR installation_id IS NULL)\n  RETURNING * INTO v_route;"
  ],
  [
    "  WHERE id = p_route_customer_id\n  RETURNING * INTO v_row;",
    "  WHERE id = p_route_customer_id\n    AND (installation_id = NULLIF(current_setting('app.installation_id', true), '') OR installation_id IS NULL)\n  RETURNING * INTO v_row;"
  ]
];

for (const [before, after] of replacements) {
  if (!source.includes(after)) {
    if (!source.includes(before)) throw new Error(`tenancy_patch_anchor_missing:${before.slice(0, 60)}`);
    source = source.replace(before, after);
  }
}

writeFileSync(target, source, "utf8");
console.log("patched installation scope into PostgreSQL parity writes");
