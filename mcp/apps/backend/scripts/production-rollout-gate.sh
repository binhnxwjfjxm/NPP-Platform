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

node --input-type=module - "$runtime_database_url" "$migration_database_url" <<'NODE'
const runtime = new URL(process.argv[2]);
const migrator = new URL(process.argv[3]);
const normalizePort = (url) => url.port || "5432";
if (runtime.hostname !== migrator.hostname || normalizePort(runtime) !== normalizePort(migrator) || runtime.pathname !== migrator.pathname) {
  throw new Error("runtime_and_migrator_target_different_databases");
}
if (decodeURIComponent(runtime.username) === decodeURIComponent(migrator.username)) {
  throw new Error("runtime_and_migrator_credentials_not_separated");
}
NODE

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
assert_existing_counts_unchanged "$restore_before" "$restore_after" "restore migration rehearsal"

NODE_ENV=production \
DATABASE_URL="$runtime_database_url" \
MCP_MIGRATION_DATABASE_URL="$migration_database_url" \
MCP_MIGRATION_ALLOW_PRODUCTION=true \
MCP_MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION \
npm --prefix mcp/apps/backend run migration:status
NODE_ENV=production \
DATABASE_URL="$runtime_database_url" \
MCP_MIGRATION_DATABASE_URL="$migration_database_url" \
MCP_MIGRATION_ALLOW_PRODUCTION=true \
MCP_MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION \
npm --prefix mcp/apps/backend run migration:migrate
NODE_ENV=production \
DATABASE_URL="$runtime_database_url" \
MCP_MIGRATION_DATABASE_URL="$migration_database_url" \
MCP_MIGRATION_ALLOW_PRODUCTION=true \
MCP_MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION \
npm --prefix mcp/apps/backend run migration:verify
NODE_ENV=production \
DATABASE_URL="$runtime_database_url" \
MCP_MIGRATION_DATABASE_URL="$migration_database_url" \
MCP_MIGRATION_ALLOW_PRODUCTION=true \
MCP_MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION \
npm --prefix mcp/apps/backend run migration:migrate

docker exec \
  -e DATABASE_URL="$migration_database_url" \
  -e MCP_DB_ROLE="$mcp_db_role" \
  "$service_id" sh -lc \
  'psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v mcp_role="$MCP_DB_ROLE" -c "SELECT shared.grant_mcp_runtime_access(:'"'"'mcp_role'"'"'::name);" >/dev/null'

snapshot_counts "$migration_database_url" "$production_after"
assert_existing_counts_unchanged "$production_before" "$production_after" "production migration"

{
  echo "MCP_LOGICAL_BACKUP_SHA256=$backup_sha256"
  echo "MCP_LOGICAL_BACKUP_SIZE_BYTES=$backup_size"
  echo "MCP_RESTORE_REHEARSAL=success"
  echo "MCP_PRODUCTION_MIGRATION=success"
  echo "MCP_PRODUCTION_RECONCILIATION=success"
} >> "$GITHUB_STEP_SUMMARY"
