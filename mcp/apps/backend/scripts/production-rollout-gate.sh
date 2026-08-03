#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_SERVICE_CONTAINER:?POSTGRES_SERVICE_CONTAINER is required}"
: "${MCP_RUNTIME_DATABASE_URL_FILE:?MCP_RUNTIME_DATABASE_URL_FILE is required}"
: "${MCP_MIGRATION_DATABASE_URL_FILE:?MCP_MIGRATION_DATABASE_URL_FILE is required}"
: "${MCP_DB_ROLE_FILE:?MCP_DB_ROLE_FILE is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

runtime_database_url="$(cat "$MCP_RUNTIME_DATABASE_URL_FILE")"
migration_database_url="$(cat "$MCP_MIGRATION_DATABASE_URL_FILE")"
mcp_db_role="$(cat "$MCP_DB_ROLE_FILE")"
restore_database="mcp_rollout_restore_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}"
restore_database="${restore_database//[^a-zA-Z0-9_]/_}"
backup_file="$RUNNER_TEMP/mcp-production-${GITHUB_RUN_ID:-local}.dump"
production_before="$RUNNER_TEMP/mcp-production-before.counts"
production_after="$RUNNER_TEMP/mcp-production-after.counts"
restore_before="$RUNNER_TEMP/mcp-restore-before.counts"
restore_after="$RUNNER_TEMP/mcp-restore-after.counts"
service_id="$POSTGRES_SERVICE_CONTAINER"
credential_mode=""
least_privilege=""
runtime_grant="not_run"
legacy_report_settings_sha256="90776e5fa02844fd59ac5519fa8d49697470d22e2c16d2a8f4966041b4ff889b"

for sensitive in "$runtime_database_url" "$migration_database_url" "$mcp_db_role"; do
  echo "::add-mask::$sensitive"
done

cleanup() {
  docker exec "$service_id" dropdb --if-exists -U postgres "$restore_database" >/dev/null 2>&1 || true
  rm -f "$backup_file" "$production_before" "$production_after" "$restore_before" "$restore_after"
}
trap cleanup EXIT

snapshot_counts() {
  local database_url="$1"
  local output_file="$2"
  docker exec -e DATABASE_URL="$database_url" "$service_id" sh -lc '
    set -eu
    psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 <<'"'"'SQL'"'"'
SELECT format(
  '"'"'SELECT %L || '"'"''"'"'='"'"''"'"' || count(*)::text FROM %I.%I;'"'"',
  tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = '"'"'mcp'"'"'
ORDER BY tablename;
\gexec
SQL
  ' | sort > "$output_file"
}

assert_existing_counts_unchanged() {
  local before_file="$1"
  local after_file="$2"
  local label="$3"
  while IFS= read -r expected; do
    if ! grep -Fqx "$expected" "$after_file"; then
      echo "Existing MCP row count changed during $label." >&2
      exit 1
    fi
  done < "$before_file"
}

assert_non_report_settings_counts_unchanged() {
  local before_file="$1"
  local after_file="$2"
  local label="$3"
  while IFS= read -r expected; do
    table_name="${expected%%=*}"
    case "$table_name" in
      mcp_report_setting_groups|mcp_report_settings) continue ;;
    esac
    if ! grep -Fqx "$expected" "$after_file"; then
      echo "Existing non-report-settings MCP row count changed during $label." >&2
      exit 1
    fi
  done < "$before_file"
}

snapshot_table_count() {
  local snapshot_file="$1"
  local table_name="$2"
  awk -F= -v table_name="$table_name" '
    $1 == table_name { print $2; found = 1 }
    END { if (!found) exit 1 }
  ' "$snapshot_file"
}

assert_report_settings_seed_growth_bounded() {
  local before_file="$1"
  local after_file="$2"
  local label="$3"
  local table_name=""
  local before_count=""
  local after_count=""
  local growth=""
  local maximum_growth=""
  for table_name in mcp_report_setting_groups mcp_report_settings; do
    before_count="$(snapshot_table_count "$before_file" "$table_name")"
    after_count="$(snapshot_table_count "$after_file" "$table_name")"
    case "$table_name" in
      mcp_report_setting_groups) maximum_growth=7 ;;
      mcp_report_settings) maximum_growth=53 ;;
      *) exit 1 ;;
    esac
    growth=$((after_count - before_count))
    if [ "$growth" -lt 0 ] || [ "$growth" -gt "$maximum_growth" ]; then
      echo "Unexpected report settings row-count change during $label for $table_name." >&2
      exit 1
    fi
  done
}

assert_legacy_report_settings_seed() {
  local database_url="$1"
  local label="$2"
  local query=""
  local result=""
  query="$(cat <<'SQL'
WITH legacy_groups AS (
  SELECT id
  FROM mcp.mcp_report_setting_groups
  WHERE installation_id = 'mcp-plan-prod'
    AND raw_payload->>'legacy_snapshot_sha256' = :'snapshot_sha'
), legacy_items AS (
  SELECT id, group_id
  FROM mcp.mcp_report_settings
  WHERE installation_id = 'mcp-plan-prod'
    AND raw_payload->>'legacy_snapshot_sha256' = :'snapshot_sha'
)
SELECT
  (SELECT count(*) FROM legacy_groups)::text || '|' ||
  (SELECT count(*) FROM legacy_items)::text || '|' ||
  (SELECT count(*)
   FROM legacy_items i
   LEFT JOIN legacy_groups g ON g.id = i.group_id
   WHERE g.id IS NULL)::text;
SQL
)"
  result="$(
    printf '%s\n' "$query" |
      docker exec -i \
        -e DATABASE_URL="$database_url" \
        -e LEGACY_REPORT_SETTINGS_SHA256="$legacy_report_settings_sha256" \
        "$service_id" sh -lc '
          psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 \
            -v snapshot_sha="$LEGACY_REPORT_SETTINGS_SHA256"
        '
  )"
  if [ "$result" != "7|53|0" ]; then
    echo "Legacy report settings reconciliation failed during $label." >&2
    exit 1
  fi
}

credential_context_json="$(
  DATABASE_URL="$runtime_database_url" \
  MCP_MIGRATION_DATABASE_URL="$migration_database_url" \
  node --input-type=module <<'NODE'
import { resolveMigrationCredentialContext } from "./mcp/apps/backend/foundation/migrations/credential-safety.js";
const context = resolveMigrationCredentialContext({ ...process.env, NODE_ENV: "production" });
process.stdout.write(JSON.stringify({
  credentialMode: context.credentialMode,
  leastPrivilege: context.leastPrivilege
}));
NODE
)"
credential_mode="$(jq -r '.credentialMode' <<<"$credential_context_json")"
least_privilege="$(jq -r '.leastPrivilege | tostring' <<<"$credential_context_json")"
test -n "$credential_mode"
test "$least_privilege" = "true" -o "$least_privilege" = "false"

docker exec -e DATABASE_URL="$migration_database_url" "$service_id" \
  pg_dump --dbname="$migration_database_url" --format=custom --no-owner --no-privileges --file=/tmp/mcp-production.dump
docker cp "$service_id:/tmp/mcp-production.dump" "$backup_file" >/dev/null
docker exec "$service_id" rm -f /tmp/mcp-production.dump
test -s "$backup_file"
backup_sha256="$(sha256sum "$backup_file" | awk '{print $1}')"
backup_size="$(stat -c '%s' "$backup_file")"

docker exec "$service_id" createdb -U postgres "$restore_database"
docker cp "$backup_file" "$service_id:/tmp/mcp-production.dump" >/dev/null
docker exec "$service_id" pg_restore -U postgres --dbname="$restore_database" --no-owner --no-privileges /tmp/mcp-production.dump
docker exec "$service_id" rm -f /tmp/mcp-production.dump

restore_database_url="postgresql://postgres:ci-mcp-production-rollout@127.0.0.1:5432/$restore_database"
snapshot_counts "$migration_database_url" "$production_before"
snapshot_counts "$restore_database_url" "$restore_before"
assert_existing_counts_unchanged "$production_before" "$restore_before" "backup restore"

NODE_ENV=test \
MCP_MIGRATION_DATABASE_URL="$restore_database_url" \
npm --prefix mcp/apps/backend run migration:migrate
NODE_ENV=test \
MCP_MIGRATION_DATABASE_URL="$restore_database_url" \
npm --prefix mcp/apps/backend run migration:verify
NODE_ENV=test \
MCP_MIGRATION_DATABASE_URL="$restore_database_url" \
npm --prefix mcp/apps/backend run migration:migrate
snapshot_counts "$restore_database_url" "$restore_after"
assert_non_report_settings_counts_unchanged "$restore_before" "$restore_after" "restore migration rehearsal"
assert_report_settings_seed_growth_bounded "$restore_before" "$restore_after" "restore migration rehearsal"
assert_legacy_report_settings_seed "$restore_database_url" "restore migration rehearsal"

NODE_ENV=production \
DATABASE_URL="$runtime_database_url" \
MCP_MIGRATION_DATABASE_URL="$migration_database_url" \
MCP_MIGRATION_CREDENTIAL_MODE="${MCP_MIGRATION_CREDENTIAL_MODE:-separated}" \
MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM="${MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM:-}" \
MCP_MIGRATION_ALLOW_PRODUCTION=true \
MCP_MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION \
npm --prefix mcp/apps/backend run migration:status
NODE_ENV=production \
DATABASE_URL="$runtime_database_url" \
MCP_MIGRATION_DATABASE_URL="$migration_database_url" \
MCP_MIGRATION_CREDENTIAL_MODE="${MCP_MIGRATION_CREDENTIAL_MODE:-separated}" \
MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM="${MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM:-}" \
MCP_MIGRATION_ALLOW_PRODUCTION=true \
MCP_MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION \
npm --prefix mcp/apps/backend run migration:migrate
NODE_ENV=production \
DATABASE_URL="$runtime_database_url" \
MCP_MIGRATION_DATABASE_URL="$migration_database_url" \
MCP_MIGRATION_CREDENTIAL_MODE="${MCP_MIGRATION_CREDENTIAL_MODE:-separated}" \
MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM="${MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM:-}" \
MCP_MIGRATION_ALLOW_PRODUCTION=true \
MCP_MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION \
npm --prefix mcp/apps/backend run migration:verify
NODE_ENV=production \
DATABASE_URL="$runtime_database_url" \
MCP_MIGRATION_DATABASE_URL="$migration_database_url" \
MCP_MIGRATION_CREDENTIAL_MODE="${MCP_MIGRATION_CREDENTIAL_MODE:-separated}" \
MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM="${MCP_MIGRATION_ESSENTIAL_OWNER_CONFIRM:-}" \
MCP_MIGRATION_ALLOW_PRODUCTION=true \
MCP_MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION \
npm --prefix mcp/apps/backend run migration:migrate

if [ "$credential_mode" = "separated" ]; then
  docker exec \
    -e DATABASE_URL="$migration_database_url" \
    -e MCP_DB_ROLE="$mcp_db_role" \
    "$service_id" sh -lc \
    'psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v mcp_role="$MCP_DB_ROLE" -c "SELECT shared.grant_mcp_runtime_access(:'"'"'mcp_role'"'"'::name);" >/dev/null'
  runtime_grant="applied"
else
  test "$credential_mode" = "essential_owner"
  test "$least_privilege" = "false"
  runtime_grant="skipped_essential_owner"
fi

snapshot_counts "$migration_database_url" "$production_after"
assert_non_report_settings_counts_unchanged "$production_before" "$production_after" "production migration"
assert_report_settings_seed_growth_bounded "$production_before" "$production_after" "production migration"
assert_legacy_report_settings_seed "$migration_database_url" "production migration"

{
  echo "MCP_LOGICAL_BACKUP_SHA256=$backup_sha256"
  echo "MCP_LOGICAL_BACKUP_SIZE_BYTES=$backup_size"
  echo "MCP_RESTORE_REHEARSAL=success"
  echo "MCP_PRODUCTION_MIGRATION=success"
  echo "MCP_PRODUCTION_RECONCILIATION=success"
  echo "MCP_LEGACY_REPORT_SETTINGS=7_groups_53_items_reconciled"
  echo "MCP_MIGRATION_CREDENTIAL_MODE=$credential_mode"
  echo "MCP_MIGRATION_LEAST_PRIVILEGE=$least_privilege"
  echo "MCP_RUNTIME_GRANT=$runtime_grant"
} >> "$GITHUB_STEP_SUMMARY"