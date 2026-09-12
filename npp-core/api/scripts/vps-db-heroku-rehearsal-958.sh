#!/usr/bin/env bash
set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${HEROKU_APP_NAME:?HEROKU_APP_NAME is required}"
: "${REQUESTED_ACTION:?REQUESTED_ACTION is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${REPORT_FILE:?REPORT_FILE is required}"
: "${SOURCE_SHA:?SOURCE_SHA is required}"

test "$HEROKU_APP_NAME" = "hung-phat"
case "$REQUESTED_ACTION" in
  audit|rehearse) ;;
  *) echo "invalid_requested_action" >&2; exit 2 ;;
esac

umask 077
: > "$REPORT_FILE"

migration_ids="$RUNNER_TEMP/heroku-migration-ids.tsv"
source_registry_ids="$RUNNER_TEMP/source-registry.ids"
source_registry_meta="$RUNNER_TEMP/source-registry.meta"
snapshot_sql="$RUNNER_TEMP/reconcile-snapshot.sql"
source_before="$RUNNER_TEMP/source-before.snapshot"
source_after="$RUNNER_TEMP/source-after.snapshot"
restored_before_migrate="$RUNNER_TEMP/restored-before-migrate.snapshot"
restored_after_migrate="$RUNNER_TEMP/restored-after-migrate.snapshot"
restored_ids="$RUNNER_TEMP/restored.ids"
restored_ids_after="$RUNNER_TEMP/restored-after.ids"
restore_db="npp_rehearsal_958"
backup_file="$RUNNER_TEMP/npp-958-${GITHUB_RUN_ID:-local}.dump"

write_snapshot_sql() {
  cat > "$snapshot_sql" <<'SQL'
CREATE TEMP TABLE reconcile_key_counts (
  relation_name text PRIMARY KEY,
  row_count bigint NOT NULL
);
DO $snapshot$
DECLARE
  relation_name text;
  relation_oid regclass;
  relation_count bigint;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'shared.customers',
    'shared.products',
    'shared.product_variants',
    'sales.sales_orders',
    'sales.sales_order_version_lines',
    'inventory.inventory_movements',
    'inventory.inventory_movement_lines',
    'purchasing.purchase_orders',
    'purchasing.goods_receipts',
    'accounting.receivable_documents',
    'accounting.payable_documents',
    'mcp.idempotency_records',
    'mcp.audit_events',
    'mcp.outbox_events'
  ]
  LOOP
    relation_oid := to_regclass(relation_name);
    IF relation_oid IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %s', relation_oid) INTO relation_count;
      INSERT INTO pg_temp.reconcile_key_counts(relation_name, row_count)
      VALUES (relation_name, relation_count);
    END IF;
  END LOOP;
END
$snapshot$;
SELECT line
FROM (
  SELECT 'key|' || relation_name || '|' || row_count::text AS line
  FROM pg_temp.reconcile_key_counts
  UNION ALL
  SELECT 'schema|' || n.nspname || '|' || count(*)::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('shared','mcp','sales','purchasing','inventory','accounting','reporting')
    AND c.relkind IN ('r','p','v','m','S')
  GROUP BY n.nspname
  UNION ALL
  SELECT 'integrity|unvalidated_foreign_keys|' || count(*)::text
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname IN ('shared','mcp','sales','purchasing','inventory','accounting','reporting')
    AND c.contype = 'f'
    AND NOT c.convalidated
  UNION ALL
  SELECT 'integrity|invalid_indexes|' || count(*)::text
  FROM pg_index i
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname IN ('shared','mcp','sales','purchasing','inventory','accounting','reporting')
    AND NOT i.indisvalid
  UNION ALL
  SELECT 'extension|' || extname || '|present'
  FROM pg_extension
) snapshot
ORDER BY line;
SQL
}

write_source_registry() {
  SOURCE_REGISTRY_IDS="$source_registry_ids" SOURCE_REGISTRY_META="$source_registry_meta" node --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from './npp-core/api/src/migrations/index.js';
import { MCP_MIGRATIONS } from './mcp/apps/backend/foundation/migrations/index.js';

const core = CORE_API_MIGRATIONS.map((item) => String(item.id)).sort();
const mcp = MCP_MIGRATIONS.map((item) => String(item.id)).sort();
const all = [...core, ...mcp].sort();
const unique = new Set(all);
if (unique.size !== all.length) throw new Error('duplicate_source_migration_id');
writeFileSync(process.env.SOURCE_REGISTRY_IDS, `${all.join('\n')}\n`);
writeFileSync(process.env.SOURCE_REGISTRY_META, [
  `SOURCE_REGISTRY_COUNT=${all.length}`,
  `SOURCE_CORE_COUNT=${core.length}`,
  `SOURCE_CORE_HEAD=${core.at(-1) || 'none'}`,
  `SOURCE_MCP_COUNT=${mcp.length}`,
  `SOURCE_MCP_HEAD=${mcp.at(-1) || 'none'}`,
].join('\n') + '\n');
NODE
}

resolve_heroku_database() {
  local config_json database_url ssl_mode
  config_json="$(heroku config -a "$HEROKU_APP_NAME" --json)"
  database_url="$(jq -r '.DATABASE_URL // empty' <<<"$config_json")"
  ssl_mode="$(jq -r '.DATABASE_SSL_MODE // "require"' <<<"$config_json")"
  test -n "$database_url"
  case "$ssl_mode" in
    require|verify-ca|verify-full) ;;
    *) echo "unexpected_heroku_database_ssl_mode" >&2; exit 3 ;;
  esac
  echo "::add-mask::$database_url"
  printf '%s' "$database_url" > "$RUNNER_TEMP/heroku-db-url"
  printf '%s' "$ssl_mode" > "$RUNNER_TEMP/heroku-db-ssl-mode"
}

heroku_psql() {
  local database_url ssl_mode
  database_url="$(cat "$RUNNER_TEMP/heroku-db-url")"
  ssl_mode="$(cat "$RUNNER_TEMP/heroku-db-ssl-mode")"
  PGSSLMODE="$ssl_mode" psql "$database_url" -XqAt -v ON_ERROR_STOP=1 "$@"
}

snapshot_source() {
  local output_file="$1"
  heroku_psql -f "$snapshot_sql" > "$output_file"
  test -s "$output_file"
}

migration_head_audit() {
  write_source_registry
  test "$(heroku_psql -c "SELECT to_regclass('shared.schema_migrations')::text")" = "shared.schema_migrations"
  heroku_psql -F $'\t' -c "SELECT id, applied_at::text FROM shared.schema_migrations ORDER BY id" > "$migration_ids"
  test -s "$migration_ids"

  PROD_MIGRATION_IDS="$migration_ids" SOURCE_REGISTRY_IDS="$source_registry_ids" AUDIT_REPORT="$RUNNER_TEMP/migration-audit.txt" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync(process.env.SOURCE_REGISTRY_IDS, 'utf8').trim().split(/\r?\n/).filter(Boolean);
const rows = readFileSync(process.env.PROD_MIGRATION_IDS, 'utf8').trim().split(/\r?\n/).filter(Boolean);
const applied = rows.map((row) => row.split('\t')[0]);
const sourceSet = new Set(source);
const appliedSet = new Set(applied);
const unknown = applied.filter((id) => !sourceSet.has(id));
const pending = source.filter((id) => !appliedSet.has(id));
const coreApplied = applied.filter((id) => !id.startsWith('mcp_')).sort();
const mcpApplied = applied.filter((id) => id.startsWith('mcp_')).sort();
const corePending = pending.filter((id) => !id.startsWith('mcp_'));
const mcpPending = pending.filter((id) => id.startsWith('mcp_'));
const duplicateApplied = applied.filter((id, index) => applied.indexOf(id) !== index);
if (unknown.length) throw new Error(`production_unknown_migration_ids:${unknown.join(',')}`);
if (duplicateApplied.length) throw new Error(`production_duplicate_migration_ids:${duplicateApplied.join(',')}`);
writeFileSync(process.env.AUDIT_REPORT, [
  'MIGRATION_HEAD_LOCK=PASS',
  `HEROKU_MIGRATION_COUNT=${applied.length}`,
  `HEROKU_CORE_HEAD=${coreApplied.at(-1) || 'none'}`,
  `HEROKU_MCP_HEAD=${mcpApplied.at(-1) || 'none'}`,
  `SOURCE_PENDING_CORE_COUNT=${corePending.length}`,
  `SOURCE_PENDING_MCP_COUNT=${mcpPending.length}`,
  `SOURCE_PENDING_CORE=${corePending.join(',') || 'none'}`,
  `SOURCE_PENDING_MCP=${mcpPending.join(',') || 'none'}`,
  'PRODUCTION_UNKNOWN_MIGRATION_COUNT=0',
].join('\n') + '\n');
NODE

  {
    echo '```text'
    cat "$source_registry_meta"
    cat "$RUNNER_TEMP/migration-audit.txt"
    echo '```'
  } >> "$REPORT_FILE"
}

ssh_base() {
  ssh \
    -i "$SSH_KEY" \
    -o BatchMode=yes \
    -o ConnectTimeout=10 \
    -o ConnectionAttempts=1 \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$KNOWN_HOSTS" \
    "$VPS_SSH_USER@$VPS_DB_HOST" "$@"
}

scp_to_vps() {
  local local_file="$1"
  local remote_file="$2"
  scp \
    -i "$SSH_KEY" \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$KNOWN_HOSTS" \
    "$local_file" "$VPS_SSH_USER@$VPS_DB_HOST:$remote_file"
}

assert_public_5432_closed() {
  if timeout 4 bash -c "cat < /dev/null > /dev/tcp/$VPS_DB_HOST/5432" 2>/dev/null; then
    echo "public_tcp_5432_open" >&2
    return 1
  fi
}

preflight_vps_db() {
  local out="$RUNNER_TEMP/vps-db-preflight.txt"
  ssh_base 'bash -s' > "$out" <<'REMOTE'
set -euo pipefail
sudo -n true
version="$(sudo -n -u postgres psql -XAtqc 'show server_version')"
case "$version" in 17.*) ;; *) exit 20 ;; esac
test "$(systemctl is-active postgresql)" = active
listen_addresses="$(sudo -n -u postgres psql -XAtqc 'show listen_addresses')"
test "$listen_addresses" = "127.0.0.1,::1"
listeners="$(ss -lntH | awk '$4 ~ /:5432$/ {print $4}')"
test -n "$listeners"
while IFS= read -r endpoint; do
  case "$endpoint" in
    127.0.0.1:5432|'[::1]':5432|::1:5432) ;;
    *) echo "non_loopback_5432_listener=$endpoint" >&2; exit 21 ;;
  esac
done <<<"$listeners"
test "$(systemctl --failed --no-legend --plain 2>/dev/null | wc -l)" = 0
echo "postgresql_version=$version"
echo "postgresql_service=active"
echo "tcp_5432_scope=loopback_only"
echo "failed_units=0"
echo "production_traffic=not_enabled"
REMOTE
  test -s "$out"
}

snapshot_remote() {
  local output_file="$1"
  ssh_base "sudo -n -u postgres psql -XqAt -v ON_ERROR_STOP=1 -d '$restore_db'" < "$snapshot_sql" > "$output_file"
  test -s "$output_file"
}

remote_migration_ids() {
  local output_file="$1"
  ssh_base "sudo -n -u postgres psql -XqAt -v ON_ERROR_STOP=1 -d '$restore_db' -c \"SELECT id FROM shared.schema_migrations ORDER BY id\"" > "$output_file"
  test -s "$output_file"
}

generate_migration_bundle() {
  local applied_file="$1"
  local bundle_file="$2"
  local meta_file="$3"
  APPLIED_IDS="$applied_file" BUNDLE_FILE="$bundle_file" BUNDLE_META="$meta_file" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from './npp-core/api/src/migrations/index.js';
import { MCP_MIGRATIONS } from './mcp/apps/backend/foundation/migrations/index.js';

const applied = new Set(readFileSync(process.env.APPLIED_IDS, 'utf8').trim().split(/\r?\n/).filter(Boolean));
const corePending = CORE_API_MIGRATIONS.filter((item) => !applied.has(String(item.id)));
const mcpPending = MCP_MIGRATIONS.filter((item) => !applied.has(String(item.id)));
for (const migration of [...corePending, ...mcpPending]) {
  if (typeof migration.sql !== 'string') throw new Error(`non_sql_rehearsal_migration:${migration.id}`);
}
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
let sql = '\\set ON_ERROR_STOP on\n';
if (corePending.length) {
  sql += 'BEGIN;\n';
  for (const migration of corePending) {
    sql += `\n-- ${migration.id}\n${migration.sql}\nINSERT INTO shared.schema_migrations(id) VALUES (${quote(migration.id)});\n`;
  }
  sql += 'COMMIT;\n';
}
if (mcpPending.length) {
  sql += 'BEGIN;\nSELECT pg_advisory_xact_lock(hashtext(\'npp-platform:mcp-migrations\'));\n';
  for (const migration of mcpPending) {
    sql += `\n-- ${migration.id}\n${migration.sql}\nINSERT INTO shared.schema_migrations(id) VALUES (${quote(migration.id)});\n`;
  }
  sql += 'COMMIT;\n';
}
if (!corePending.length && !mcpPending.length) sql += 'SELECT 1;\n';
writeFileSync(process.env.BUNDLE_FILE, sql);
writeFileSync(process.env.BUNDLE_META, [
  `PENDING_CORE_COUNT=${corePending.length}`,
  `PENDING_MCP_COUNT=${mcpPending.length}`,
  `PENDING_CORE=${corePending.map((item) => item.id).join(',') || 'none'}`,
  `PENDING_MCP=${mcpPending.map((item) => item.id).join(',') || 'none'}`,
].join('\n') + '\n');
NODE
}

run_rehearsal() {
  : "${VPS_DB_HOST:?VPS_DB_HOST is required}"
  : "${VPS_SSH_USER:?VPS_SSH_USER is required}"
  : "${SSH_KEY:?SSH_KEY is required}"
  : "${KNOWN_HOSTS:?KNOWN_HOSTS is required}"

  assert_public_5432_closed
  preflight_vps_db
  write_snapshot_sql

  snapshot_source "$source_before"

  heroku pg:backups:capture -a "$HEROKU_APP_NAME" > "$RUNNER_TEMP/heroku-backup-capture.log" 2>&1
  backup_url="$(heroku pg:backups:url -a "$HEROKU_APP_NAME")"
  test -n "$backup_url"
  echo "::add-mask::$backup_url"
  curl --fail --silent --show-error --location "$backup_url" --output "$backup_file"
  unset backup_url
  test -s "$backup_file"
  backup_bytes="$(stat -c '%s' "$backup_file")"
  backup_sha256="$(sha256sum "$backup_file" | awk '{print $1}')"

  snapshot_source "$source_after"
  source_window_stable=no
  if cmp -s "$source_before" "$source_after"; then
    source_window_stable=yes
  fi

  migration_ids_after="$RUNNER_TEMP/heroku-migration-ids-after.tsv"
  heroku_psql -F $'\t' -c "SELECT id, applied_at::text FROM shared.schema_migrations ORDER BY id" > "$migration_ids_after"
  migration_window_stable=no
  if cmp -s "$migration_ids" "$migration_ids_after"; then
    migration_window_stable=yes
  fi

  remote_dump="/tmp/npp-958-${GITHUB_RUN_ID:-local}.dump"
  scp_to_vps "$backup_file" "$remote_dump"

  ssh_base "bash -s -- '$restore_db' '$remote_dump'" <<'REMOTE'
set -euo pipefail
db="$1"
dump="$2"
sudo -n true
version="$(sudo -n -u postgres psql -XAtqc 'show server_version')"
case "$version" in 17.*) ;; *) exit 30 ;; esac
sudo -n -u postgres psql -XAt -v ON_ERROR_STOP=1 postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid();" >/dev/null
sudo -n -u postgres dropdb --if-exists "$db"
sudo -n -u postgres createdb "$db"
sudo -n -u postgres pg_restore --exit-on-error --no-owner --no-acl --dbname="$db" "$dump"
rm -f "$dump"
REMOTE

  remote_migration_ids "$restored_ids"
  restored_registry_match=no
  cut -f1 "$migration_ids_after" > "$RUNNER_TEMP/heroku-ids-only"
  if cmp -s "$RUNNER_TEMP/heroku-ids-only" "$restored_ids"; then
    restored_registry_match=yes
  fi

  snapshot_remote "$restored_before_migrate"
  pre_migration_data_match=no
  if [ "$source_window_stable" = yes ] && cmp -s "$source_after" "$restored_before_migrate"; then
    pre_migration_data_match=yes
  fi

  first_bundle="$RUNNER_TEMP/rehearsal-migrations-first.sql"
  first_meta="$RUNNER_TEMP/rehearsal-migrations-first.meta"
  generate_migration_bundle "$restored_ids" "$first_bundle" "$first_meta"
  remote_first_bundle="/tmp/npp-958-migrations-${GITHUB_RUN_ID:-local}.sql"
  scp_to_vps "$first_bundle" "$remote_first_bundle"
  ssh_base "sudo -n -u postgres psql -XqAt -v ON_ERROR_STOP=1 -d '$restore_db' -f '$remote_first_bundle' >/dev/null && rm -f '$remote_first_bundle'"

  remote_migration_ids "$restored_ids_after"
  final_registry_match=no
  if cmp -s "$source_registry_ids" "$restored_ids_after"; then
    final_registry_match=yes
  fi

  noop_bundle="$RUNNER_TEMP/rehearsal-migrations-noop.sql"
  noop_meta="$RUNNER_TEMP/rehearsal-migrations-noop.meta"
  generate_migration_bundle "$restored_ids_after" "$noop_bundle" "$noop_meta"
  test "$(awk -F= '$1=="PENDING_CORE_COUNT"{print $2}' "$noop_meta")" = 0
  test "$(awk -F= '$1=="PENDING_MCP_COUNT"{print $2}' "$noop_meta")" = 0
  remote_noop_bundle="/tmp/npp-958-migrations-noop-${GITHUB_RUN_ID:-local}.sql"
  scp_to_vps "$noop_bundle" "$remote_noop_bundle"
  ssh_base "sudo -n -u postgres psql -XqAt -v ON_ERROR_STOP=1 -d '$restore_db' -f '$remote_noop_bundle' >/dev/null && rm -f '$remote_noop_bundle'"

  snapshot_remote "$restored_after_migrate"
  unvalidated_fks="$(awk -F'|' '$1=="integrity" && $2=="unvalidated_foreign_keys"{print $3}' "$restored_after_migrate")"
  invalid_indexes="$(awk -F'|' '$1=="integrity" && $2=="invalid_indexes"{print $3}' "$restored_after_migrate")"

  assert_public_5432_closed

  rehearsal_gate=PASS
  if [ "$source_window_stable" != yes ] ||
     [ "$migration_window_stable" != yes ] ||
     [ "$restored_registry_match" != yes ] ||
     [ "$pre_migration_data_match" != yes ] ||
     [ "$final_registry_match" != yes ] ||
     [ "${unvalidated_fks:-1}" != 0 ] ||
     [ "${invalid_indexes:-1}" != 0 ]; then
    rehearsal_gate=FAIL
  fi

  {
    echo
    echo '```text'
    echo "HEROKU_BACKUP_CAPTURE=PASS"
    echo "BACKUP_BYTES=$backup_bytes"
    echo "BACKUP_SHA256=$backup_sha256"
    echo "SOURCE_WINDOW_STABLE=$source_window_stable"
    echo "MIGRATION_WINDOW_STABLE=$migration_window_stable"
    echo "RESTORE_DATABASE=$restore_db"
    echo "PG_RESTORE=PASS"
    echo "RESTORED_REGISTRY_MATCH=$restored_registry_match"
    echo "PRE_MIGRATION_RECONCILIATION=$pre_migration_data_match"
    cat "$first_meta"
    echo "FINAL_REGISTRY_MATCH=$final_registry_match"
    echo "MIGRATION_RERUN_NOOP=PASS"
    echo "UNVALIDATED_FOREIGN_KEYS=${unvalidated_fks:-unknown}"
    echo "INVALID_INDEXES=${invalid_indexes:-unknown}"
    echo "PUBLIC_TCP_5432=closed"
    echo "PRODUCTION_TRAFFIC=not_enabled"
    echo "CUTOVER=not_performed"
    echo "REHEARSAL_GATE=$rehearsal_gate"
    echo '```'
  } >> "$REPORT_FILE"

  test "$rehearsal_gate" = PASS
}

resolve_heroku_database
write_snapshot_sql
migration_head_audit

if [ "$REQUESTED_ACTION" = audit ]; then
  {
    echo
    echo "- Scope: targeted read-only query of \`shared.schema_migrations\`; no backup, migration or VPS mutation."
  } >> "$REPORT_FILE"
  exit 0
fi

run_rehearsal
