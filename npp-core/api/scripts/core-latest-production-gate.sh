#!/usr/bin/env bash
set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${HEROKU_APP_NAME:?HEROKU_APP_NAME is required}"
: "${POSTGRES_SERVICE_CONTAINER:?POSTGRES_SERVICE_CONTAINER is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

action="${REQUESTED_ACTION:-audit}"
test "$HEROKU_APP_NAME" = "hung-phat"

expected_pending_json='["042_sales_fulfillment_reservation_demand","043_sales_fulfillment_allocation_pick_pack","044_sales_delivery_order_handover","045_sales_inventory_issue_customer_return","046_logistics_trip_planning","047_logistics_trip_dispatch","048_logistics_driver_delivery_read","049_logistics_delivery_attempts","050_logistics_delivery_attempt_outbox_schedule","051_logistics_trip_reconciliation","052_logistics_optional_proof_of_delivery"]'
maintenance_enabled="false"
backup_id=""
restore_database="core_latest_restore_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}"
restore_database="${restore_database//[^a-zA-Z0-9_]/_}"
backup_file="$RUNNER_TEMP/core-latest-${GITHUB_RUN_ID:-local}.dump"
before_file="$RUNNER_TEMP/core-latest-before.counts"
after_file="$RUNNER_TEMP/core-latest-after.counts"
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
const pool = new Pool({
  connectionString: process.env.CORE_GATE_DATABASE_URL,
  ssl: buildSslConfig(process.env.CORE_GATE_SSL_MODE),
  application_name: "npp-core-latest-production-gate",
});
try {
  let result;
  if (command === "status") result = await migrationStatusWithAdapter(pool, CORE_API_MIGRATIONS);
  else if (command === "migrate") result = await runMigrations(pool, CORE_API_MIGRATIONS);
  else if (command === "verify") result = await migrationVerifyWithAdapter(pool);
  else if (command === "phase6e") {
    const requiredTables = [
      "logistics.delivery_routes",
      "logistics.vehicles",
      "logistics.driver_profiles",
      "logistics.delivery_trips",
      "logistics.trip_stops",
      "logistics.trip_order_assignments",
      "logistics.trip_events",
      "logistics.trip_dispatch_items",
      "logistics.delivery_attempts",
      "logistics.delivery_attempt_lines",
      "logistics.trip_return_receipts",
      "logistics.trip_return_receipt_lines",
      "logistics.delivery_attempt_proofs",
    ];
    const requiredPermissions = [
      "core.delivery-trip.read",
      "core.delivery-trip.create",
      "core.delivery-trip.plan",
      "core.delivery-trip.assign",
      "core.delivery-trip.lock",
      "core.delivery-trip.dispatch",
      "core.delivery-trip.driver-read",
      "core.delivery-attempt.read",
      "core.delivery-attempt.record",
      "core.delivery-trip.reconciliation-read",
      "core.delivery-trip.return-receive",
      "core.delivery-trip.close",
      "core.pod.read",
      "core.pod.attach",
    ];
    const tableRows = await pool.query(
      `SELECT expected.required_name,
              to_regclass(expected.required_name) IS NOT NULL AS present
         FROM unnest($1::text[]) AS expected(required_name)
        ORDER BY expected.required_name`,
      [requiredTables],
    );
    const permissionRows = await pool.query(
      `SELECT expected.permission_key,
              catalog.permission_key IS NOT NULL AS present
         FROM unnest($1::text[]) AS expected(permission_key)
         LEFT JOIN shared.permission_catalog catalog
           ON catalog.permission_key = expected.permission_key
        ORDER BY expected.permission_key`,
      [requiredPermissions],
    );
    const missingTables = tableRows.rows.filter((row) => !row.present).map((row) => row.required_name);
    const missingPermissions = permissionRows.rows.filter((row) => !row.present).map((row) => row.permission_key);
    result = {
      ok: missingTables.length === 0 && missingPermissions.length === 0,
      missingTables,
      missingPermissions,
      registryTail: CORE_API_MIGRATIONS.slice(-7).map((migration) => migration.id),
    };
  } else throw new Error("unknown_core_gate_command");
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
  PENDING_JSON="$pending" EXPECTED_PENDING_JSON="$expected_pending_json" node --input-type=module <<'NODE'
const pending = JSON.parse(process.env.PENDING_JSON || '[]');
const expected = JSON.parse(process.env.EXPECTED_PENDING_JSON || '[]');
if (!Array.isArray(pending) || !pending.every((item) => typeof item === 'string')) {
  throw new Error('invalid_pending_migration_shape');
}
const start = expected.length - pending.length;
const allowed = start >= 0 && pending.every((item, index) => item === expected[start + index]);
if (!allowed) {
  throw new Error(`unexpected_pending_migrations:${JSON.stringify(pending)}`);
}
NODE
}

assert_phase6e_schema() {
  local target_url="$1"
  local target_ssl_mode="$2"
  local output
  output="$(run_core_command phase6e "$target_url" "$target_ssl_mode")"
  test "$(jq -r '.result.ok' <<<"$output")" = "true"
  test "$(jq -c '.result.registryTail' <<<"$output")" = '["046_logistics_trip_planning","047_logistics_trip_dispatch","048_logistics_driver_delivery_read","049_logistics_delivery_attempts","050_logistics_delivery_attempt_outbox_schedule","051_logistics_trip_reconciliation","052_logistics_optional_proof_of_delivery"]'
}

snapshot_protected_counts() {
  local target_url="$1"
  local output_file="$2"
  docker exec -e PGSSLMODE=require -e DATABASE_URL="$target_url" "$service_id" sh -lc '
    set -eu
    psql "$DATABASE_URL" -XAt -v ON_ERROR_STOP=1 <<'"'"'SQL'"'"'
SELECT '"'"'shared.customers='"'"' || count(*)::text FROM shared.customers;
SELECT '"'"'shared.customer_addresses='"'"' || count(*)::text FROM shared.customer_addresses;
SELECT '"'"'shared.employees='"'"' || count(*)::text FROM shared.employees;
SELECT '"'"'shared.warehouses='"'"' || count(*)::text FROM shared.warehouses;
SELECT '"'"'sales.sales_orders='"'"' || count(*)::text FROM sales.sales_orders;
SELECT '"'"'sales.sales_order_lines='"'"' || count(*)::text FROM sales.sales_order_lines;
SELECT '"'"'inventory.inventory_movements='"'"' || count(*)::text FROM inventory.inventory_movements;
SELECT '"'"'inventory.inventory_movement_lines='"'"' || count(*)::text FROM inventory.inventory_movement_lines;
SQL
  ' | sort > "$output_file"
}

assert_counts_unchanged() {
  diff -u "$1" "$2"
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
echo "CORE_MIGRATION_EXPECTED_TAIL=$expected_pending_json" >> "$GITHUB_STEP_SUMMARY"

if [ "$action" = "audit" ]; then
  echo "CORE_MIGRATION_OPERATION=audit" >> "$GITHUB_STEP_SUMMARY"
  if [ "$production_pending" = '[]' ]; then
    assert_phase6e_schema "$database_url" "$ssl_mode"
    echo "CORE_PHASE_6E_SCHEMA=ready" >> "$GITHUB_STEP_SUMMARY"
  else
    echo "CORE_PHASE_6E_SCHEMA=pending_migration" >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
fi

test "$action" = "migrate"

capture_output="$(heroku pg:backups:capture DATABASE_URL -a "$HEROKU_APP_NAME" 2>&1)"
printf '%s\n' "$capture_output"
backup_id="$(printf '%s\n' "$capture_output" | tr -d '\r' | sed -nE 's/.*Backing up .* to (b[0-9]+)\.\.\. done.*/\1/p' | tail -n 1)"
test -n "$backup_id"
heroku pg:backups:info "$backup_id" -a "$HEROKU_APP_NAME" >/dev/null

docker exec -e PGSSLMODE=require -e DATABASE_URL="$database_url" "$service_id" \
  pg_dump --dbname="$database_url" --format=custom --no-owner --no-privileges --file=/tmp/core-latest.dump
docker cp "$service_id:/tmp/core-latest.dump" "$backup_file" >/dev/null
docker exec "$service_id" rm -f /tmp/core-latest.dump
test -s "$backup_file"
backup_sha256="$(sha256sum "$backup_file" | awk '{print $1}')"
backup_size="$(stat -c '%s' "$backup_file")"

docker exec "$service_id" createdb -U postgres "$restore_database"
docker cp "$backup_file" "$service_id:/tmp/core-latest.dump" >/dev/null
docker exec "$service_id" pg_restore -U postgres --dbname="$restore_database" --no-owner --no-privileges /tmp/core-latest.dump
docker exec "$service_id" rm -f /tmp/core-latest.dump
restore_url="postgresql://postgres:ci-core-latest-rollout@127.0.0.1:5432/$restore_database"

restore_status="$(run_core_command status "$restore_url" disable)"
restore_pending="$(pending_json "$restore_status")"
assert_allowed_pending "$restore_pending"
run_core_command migrate "$restore_url" disable
restore_verify="$(run_core_command verify "$restore_url" disable)"
test "$(jq -r '.result.verified' <<<"$restore_verify")" = "true"
run_core_command migrate "$restore_url" disable
restore_final="$(run_core_command status "$restore_url" disable)"
test "$(pending_json "$restore_final")" = '[]'
assert_phase6e_schema "$restore_url" disable

snapshot_protected_counts "$database_url" "$before_file"
heroku maintenance:on -a "$HEROKU_APP_NAME" >/dev/null
maintenance_enabled="true"
run_core_command migrate "$database_url" "$ssl_mode"
production_verify="$(run_core_command verify "$database_url" "$ssl_mode")"
test "$(jq -r '.result.verified' <<<"$production_verify")" = "true"
run_core_command migrate "$database_url" "$ssl_mode"
production_final="$(run_core_command status "$database_url" "$ssl_mode")"
test "$(pending_json "$production_final")" = '[]'
assert_phase6e_schema "$database_url" "$ssl_mode"
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
  echo "CORE_PHASE_6E_SCHEMA=ready"
  echo "CORE_PRODUCTION_MIGRATION=success"
  echo "CORE_PRODUCTION_PENDING=[]"
  echo "CORE_PRODUCTION_RECONCILIATION=success"
} >> "$GITHUB_STEP_SUMMARY"
