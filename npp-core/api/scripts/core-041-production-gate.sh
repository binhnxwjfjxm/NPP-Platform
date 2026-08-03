#!/usr/bin/env bash
set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${HEROKU_APP_NAME:?HEROKU_APP_NAME is required}"
: "${POSTGRES_SERVICE_CONTAINER:?POSTGRES_SERVICE_CONTAINER is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

action="${REQUESTED_ACTION:-audit}"
test "$HEROKU_APP_NAME" = "hung-phat"

maintenance_enabled="false"
backup_id=""
restore_database="core_041_restore_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}"
restore_database="${restore_database//[^a-zA-Z0-9_]/_}"
backup_file="$RUNNER_TEMP/core-041-${GITHUB_RUN_ID:-local}.dump"
before_file="$RUNNER_TEMP/core-041-before.counts"
after_file="$RUNNER_TEMP/core-041-after.counts"
service_id="$POSTGRES_SERVICE_CONTAINER"

cleanup() {
  if [ "$maintenance_enabled" = "true" ]; then
    heroku maintenance:off -a "$HEROKU_APP_NAME" >/dev/null 2>&1 || true
  fi
  docker exec "$service_id" dropdb --if-exists -U postgres "$restore_database" >/dev/null 2>&1 || true
  rm -f "$backup_file" "$before_file" "$after_file"
}
trap cleanup EXIT

config_json="$(heroku config -a "$HEROKU_APP_NAME" --json)"
database_url="$(jq -r '.DATABASE_URL // empty' <<<"$config_json")"
ssl_mode="$(jq -r '.DATABASE_SSL_MODE // "require"' <<<"$config_json")"
test -n "$database_url"
case "$ssl_mode" in
  require|verify-full) ;;
  *) echo "Core production DATABASE_SSL_MODE must require TLS." >&2; exit 1 ;;
esac
echo "::add-mask::$database_url"

app_url="$(
  curl --fail --silent --show-error \
    -H 'Accept: application/vnd.heroku+json; version=3' \
    -H "Authorization: Bearer $HEROKU_API_KEY" \
    "https://api.heroku.com/apps/$HEROKU_APP_NAME" \
    | jq -r '.web_url // empty' \
    | sed 's:/*$::'
)"
test -n "$app_url"

run_core_command() {
  local command="$1"
  local target_url="$2"
  local target_ssl_mode="$3"
  CORE_GATE_COMMAND="$command" \
  CORE_GATE_DATABASE_URL="$target_url" \
  CORE_GATE_SSL_MODE="$target_ssl_mode" \
  node --input-type=module <<'NODE'
import pg from "pg";
import { CORE_API_MIGRATIONS, runMigrations } from "./npp-core/api/src/migrations/index.js";
import { migrationStatusWithAdapter, migrationVerifyWithAdapter } from "./npp-core/api/src/migrations/cli.js";
import { buildSslConfig } from "./npp-core/api/src/db/pool.js";

const { Pool } = pg;
const command = process.env.CORE_GATE_COMMAND;
const connectionString = process.env.CORE_GATE_DATABASE_URL;
const sslMode = process.env.CORE_GATE_SSL_MODE;
const pool = new Pool({
  connectionString,
  ssl: buildSslConfig(sslMode),
  application_name: "npp-core-041-production-gate"
});
try {
  let result;
  if (command === "status") result = await migrationStatusWithAdapter(pool, CORE_API_MIGRATIONS);
  else if (command === "migrate") result = await runMigrations(pool, CORE_API_MIGRATIONS);
  else if (command === "verify") result = await migrationVerifyWithAdapter(pool);
  else throw new Error("unknown_core_gate_command");
  process.stdout.write(`${JSON.stringify({ command, result })}\n`);
} finally {
  await pool.end();
}
NODE
}

pending_json() {
  jq -c '.result.pending // []' <<<"$1"
}

assert_allowed_pending() {
  local pending="$1"
  case "$pending" in
    '[]'|'["041_customer_onboarding_requests"]') ;;
    *)
      echo "Core migration gate refuses unexpected pending migrations: $pending" >&2
      exit 1
      ;;
  esac
}

snapshot_protected_counts() {
  local target_url="$1"
  local output_file="$2"
  docker exec -e PGSSLMODE=require -e DATABASE_URL="$target_url" "$service_id" sh -lc '
    set -eu
    psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 <<'"'"'SQL'"'"'
SELECT '"'"'shared.customers='"'"' || count(*)::text FROM shared.customers;
SELECT '"'"'shared.customer_addresses='"'"' || count(*)::text FROM shared.customer_addresses;
SQL
  ' | sort > "$output_file"
}

assert_counts_unchanged() {
  local before="$1"
  local after="$2"
  diff -u "$before" "$after"
}

smoke_health() {
  local path="$1"
  local deadline=$((SECONDS + 180))
  local status=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(curl --silent --show-error --connect-timeout 5 --max-time 10 --output /dev/null --write-out '%{http_code}' "$app_url$path" || true)"
    if [ "$status" = "200" ]; then return 0; fi
    sleep 3
  done
  echo "Core health smoke failed for $path; last status=${status:-none}." >&2
  return 1
}

status_output="$(run_core_command status "$database_url" "$ssl_mode")"
production_pending="$(pending_json "$status_output")"
assert_allowed_pending "$production_pending"

echo "CORE_MIGRATION_PENDING=$production_pending" >> "$GITHUB_STEP_SUMMARY"

if [ "$action" = "audit" ]; then
  echo "CORE_MIGRATION_OPERATION=audit" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

test "$action" = "migrate"

capture_output="$(heroku pg:backups:capture DATABASE_URL -a "$HEROKU_APP_NAME" 2>&1)"
printf '%s\n' "$capture_output"
backup_id="$(printf '%s\n' "$capture_output" | tr -d '\r' | sed -nE 's/.*Backing up .* to (b[0-9]+)\.\.\. done.*/\1/p' | tail -n 1)"
test -n "$backup_id"
heroku pg:backups:info "$backup_id" -a "$HEROKU_APP_NAME" >/dev/null

docker exec -e PGSSLMODE=require -e DATABASE_URL="$database_url" "$service_id" \
  pg_dump --dbname="$database_url" --format=custom --no-owner --no-privileges --file=/tmp/core-041.dump
docker cp "$service_id:/tmp/core-041.dump" "$backup_file" >/dev/null
docker exec "$service_id" rm -f /tmp/core-041.dump
test -s "$backup_file"
backup_sha256="$(sha256sum "$backup_file" | awk '{print $1}')"
backup_size="$(stat -c '%s' "$backup_file")"

docker exec "$service_id" createdb -U postgres "$restore_database"
docker cp "$backup_file" "$service_id:/tmp/core-041.dump" >/dev/null
docker exec "$service_id" pg_restore -U postgres --dbname="$restore_database" --no-owner --no-privileges /tmp/core-041.dump
docker exec "$service_id" rm -f /tmp/core-041.dump
restore_url="postgresql://postgres:ci-core-041-rollout@127.0.0.1:5432/$restore_database"

restore_status="$(run_core_command status "$restore_url" disable)"
restore_pending="$(pending_json "$restore_status")"
assert_allowed_pending "$restore_pending"
run_core_command migrate "$restore_url" disable
restore_verify="$(run_core_command verify "$restore_url" disable)"
test "$(jq -r '.result.verified' <<<"$restore_verify")" = "true"
run_core_command migrate "$restore_url" disable
restore_final="$(run_core_command status "$restore_url" disable)"
test "$(pending_json "$restore_final")" = '[]'

snapshot_protected_counts "$database_url" "$before_file"
heroku maintenance:on -a "$HEROKU_APP_NAME" >/dev/null
maintenance_enabled="true"
run_core_command migrate "$database_url" "$ssl_mode"
production_verify="$(run_core_command verify "$database_url" "$ssl_mode")"
test "$(jq -r '.result.verified' <<<"$production_verify")" = "true"
run_core_command migrate "$database_url" "$ssl_mode"
production_final="$(run_core_command status "$database_url" "$ssl_mode")"
test "$(pending_json "$production_final")" = '[]'
snapshot_protected_counts "$database_url" "$after_file"
assert_counts_unchanged "$before_file" "$after_file"
heroku maintenance:off -a "$HEROKU_APP_NAME" >/dev/null
maintenance_enabled="false"
smoke_health /health/live
smoke_health /health/ready

{
  echo "CORE_MIGRATION_OPERATION=migrate"
  echo "CORE_PRODUCTION_BACKUP_ID=$backup_id"
  echo "CORE_LOGICAL_BACKUP_SHA256=$backup_sha256"
  echo "CORE_LOGICAL_BACKUP_SIZE_BYTES=$backup_size"
  echo "CORE_RESTORE_REHEARSAL=success"
  echo "CORE_PRODUCTION_MIGRATION=success"
  echo "CORE_PRODUCTION_PENDING=[]"
  echo "CORE_PRODUCTION_RECONCILIATION=success"
} >> "$GITHUB_STEP_SUMMARY"
