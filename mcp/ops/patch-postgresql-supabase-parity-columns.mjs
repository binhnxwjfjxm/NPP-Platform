import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "mcp/ops/generate-postgresql-supabase-parity.mjs");
let source = readFileSync(target, "utf8");

source = source.replace(
  "ALTER TABLE mcp.mcp_visits\n  ADD COLUMN IF NOT EXISTS has_order boolean NOT NULL DEFAULT false,",
  "ALTER TABLE mcp.mcp_visits\n  ADD COLUMN IF NOT EXISTS visited_at timestamptz,\n  ADD COLUMN IF NOT EXISTS has_order boolean NOT NULL DEFAULT false,"
);

source = source.replace(
  "ALTER TABLE mcp.test_customer_results\n  ADD COLUMN IF NOT EXISTS session_customer_id text;",
  "ALTER TABLE mcp.test_customer_results\n  ADD COLUMN IF NOT EXISTS session_customer_id text,\n  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced';\n\nALTER TABLE mcp.test_customers\n  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced';\n\nALTER TABLE mcp.test_file_products\n  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',\n  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced';"
);

const settingsTables = `CREATE TABLE IF NOT EXISTS mcp.mcp_setting_groups (
  id text PRIMARY KEY DEFAULT ('msg_' || replace(gen_random_uuid()::text, '-', '')),
  group_key text NOT NULL,
  title text NOT NULL,
  group_type text NOT NULL DEFAULT 'market_report',
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_setting_groups_group_key_unique UNIQUE (group_key),
  CONSTRAINT mcp_setting_groups_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT mcp_setting_groups_sort_order_check CHECK (sort_order BETWEEN 0 AND 100000)
);

CREATE TABLE IF NOT EXISTS mcp.mcp_setting_items (
  id text PRIMARY KEY DEFAULT ('msi_' || replace(gen_random_uuid()::text, '-', '')),
  group_id text NOT NULL REFERENCES mcp.mcp_setting_groups(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  label text NOT NULL,
  value text,
  category text,
  brand_name text,
  product_id text,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_setting_items_group_key_unique UNIQUE (group_id, item_key),
  CONSTRAINT mcp_setting_items_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT mcp_setting_items_sort_order_check CHECK (sort_order BETWEEN 0 AND 100000)
);

CREATE INDEX IF NOT EXISTS mcp_setting_groups_type_status_sort_idx
  ON mcp.mcp_setting_groups(group_type, status, sort_order, id);
CREATE INDEX IF NOT EXISTS mcp_setting_items_group_status_sort_idx
  ON mcp.mcp_setting_items(group_id, status, sort_order, id);

`;

if (!source.includes("CREATE TABLE IF NOT EXISTS mcp.mcp_setting_groups")) {
  source = source.replace(
    "ALTER TABLE mcp.mcp_report_setting_groups",
    `${settingsTables}ALTER TABLE mcp.mcp_report_setting_groups`
  );
}

const postTableParity = `ALTER TABLE mcp.mcp_outlet_media
  ADD COLUMN IF NOT EXISTS delete_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delete_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_delete_error text;

ALTER TABLE mcp.mcp_outlet_media
  DROP CONSTRAINT IF EXISTS mcp_outlet_media_status_check;
ALTER TABLE mcp.mcp_outlet_media
  ADD CONSTRAINT mcp_outlet_media_status_check
  CHECK (status IN ('pending', 'ready', 'failed', 'deleting', 'delete_failed', 'deleted'));

CREATE INDEX IF NOT EXISTS mcp_outlet_media_delete_retry_idx
  ON mcp.mcp_outlet_media(status, updated_at)
  WHERE status IN ('deleting', 'delete_failed');`;

if (!source.includes("const POST_TABLE_PARITY = `")) {
  source = source.replace(
    "const FOOTER = `",
    `const POST_TABLE_PARITY = \`${postTableParity}\`;\n\nconst FOOTER = \``
  );
}

source = source.replace(
  "`${HEADER}\\n${tableSql}\\n\\n${functionSql}${FOOTER}`",
  "`${HEADER}\\n${tableSql}\\n\\n${POST_TABLE_PARITY}\\n\\n${functionSql}${FOOTER}`"
);

writeFileSync(target, source, "utf8");
console.log("patched complete Supabase parity fields");
