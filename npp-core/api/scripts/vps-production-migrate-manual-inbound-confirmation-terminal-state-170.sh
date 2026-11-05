#!/usr/bin/env bash
set -euo pipefail
source_sha="$1"
run_id="$2"
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "$run_id" =~ ^[0-9]+$ ]] || exit 1
db=npp_production
migration=170_manual_inbound_confirmation_terminal_state
sqlfile="/tmp/npp-170-$source_sha.sql"
rehearsal="npp_migration_rehearsal_$run_id"
backup="/var/backups/npp/migrations/$source_sha-$run_id-170.dump"

sudo -n true
for c in psql pg_dump pg_restore createdb dropdb sha256sum; do command -v "$c" >/dev/null; done
test -s "$sqlfile"
chmod 0644 "$sqlfile"
cleanup() { sudo -n -u postgres dropdb --if-exists "$rehearsal" >/dev/null 2>&1 || true; rm -f "$sqlfile"; }
trap cleanup EXIT
scalar() { sudo -n -u postgres psql -XAt -v ON_ERROR_STOP=1 -d "$1" -c "$2"; }
counts() {
  scalar "$1" "SELECT 'orders='||count(*) FROM sales.sales_orders
    UNION ALL SELECT 'versions='||count(*) FROM sales.sales_order_versions
    UNION ALL SELECT 'lines='||count(*) FROM sales.sales_order_version_lines
    UNION ALL SELECT 'demands='||count(*) FROM sales.sales_order_fulfillment_demands
    UNION ALL SELECT 'balances='||count(*) FROM inventory.inventory_balances ORDER BY 1"
}
sums() {
  scalar "$1" "SELECT
    (SELECT coalesce(sum(total),0)::text FROM sales.sales_order_versions)||'|'||
    (SELECT coalesce(sum(line_total),0)::text FROM sales.sales_order_version_lines)||'|'||
    (SELECT coalesce(sum(on_hand_quantity),0)::text FROM inventory.inventory_balances)"
}
verify() {
  local applied valid
  applied="$(scalar "$1" "SELECT count(*) FROM shared.schema_migrations WHERE id='$migration'")"
  valid="$(scalar "$1" "SELECT count(*) FROM pg_class t
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='inventory'
      AND t.relname='manual_inbound_confirmation_cancellations'
      AND t.relkind='r'")"
  trigger="$(scalar "$1" "SELECT count(*) FROM pg_trigger tg
    JOIN pg_class t ON t.oid=tg.tgrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='inventory'
      AND t.relname='manual_inbound_confirmation_cancellations'
      AND tg.tgname='manual_inbound_confirmation_cancellations_append_only'
      AND tg.tgenabled='O' AND NOT tg.tgisinternal")"
  test "$applied" = 1 && test "$valid" = 1 && test "$trigger" = 1
  echo "TARGET=$1 MIGRATION_REGISTERED=$applied CANCELLATION_TABLE_VALID=$valid APPEND_ONLY_TRIGGER_VALID=$trigger"
}
apply() {
  if [ "$(scalar "$1" "SELECT count(*) FROM shared.schema_migrations WHERE id='$migration'")" = 1 ]; then
    verify "$1"; return
  fi
  sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -d "$1" -v migration_id="$migration" -v migration_sql="$sqlfile" >/dev/null <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
\i :migration_sql
INSERT INTO shared.schema_migrations (id) VALUES (:'migration_id') ON CONFLICT (id) DO NOTHING;
COMMIT;
SQL
  verify "$1"
}
test "$(scalar postgres "SELECT count(*) FROM pg_database WHERE datname='npp_production'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='169_manual_inbound_last_entered_cost_lookup'")" = 1
# A disconnected GitHub runner must not start another restore while the old
# rehearsal is still using the database. Print only counts, not SQL or secrets.
active_rehearsals="$(scalar postgres "SELECT count(*) FROM pg_stat_activity WHERE datname LIKE 'npp_migration_rehearsal_%' AND pid <> pg_backend_pid()")"
echo "ACTIVE_REHEARSAL_SESSIONS=$active_rehearsals"
test "$active_rehearsals" = 0
existing_rehearsals="$(scalar postgres "SELECT count(*) FROM pg_database WHERE datname LIKE 'npp_migration_rehearsal_%'")"
echo "EXISTING_REHEARSAL_DATABASES=$existing_rehearsals"
echo "DATABASE_READONLY_PREFLIGHT=PASS"
applied="$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='$migration'")"
if [ "$applied" = 1 ]; then
  verify "$db"
  echo "MIGRATION=170 SOURCE_SHA=$source_sha PRODUCTION_MIGRATION=ALREADY_APPLIED PRODUCTION_VERIFY=PASS"
  exit 0
fi
test "$applied" = 0
test "$(scalar "$db" "SELECT count(*) FROM information_schema.tables WHERE table_schema='inventory' AND table_name='manual_inbound_confirmation_cancellations'")" = 0
db_bytes="$(scalar postgres "SELECT pg_database_size('npp_production')")"
free_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
test "$db_bytes" -gt 0 && test "$((free_kb * 1024))" -gt "$((db_bytes * 2))"
sudo -n install -d -o postgres -g postgres -m 0700 /var/backups/npp/migrations
sudo -n -u postgres pg_dump -Fc -d "$db" -f "$backup"
backup_bytes="$(sudo -n stat -c '%s' "$backup")"
test "$backup_bytes" -gt 0
checksum="$(sudo -n -u postgres sha256sum "$backup" | awk '{print $1}')"
[[ "$checksum" =~ ^[0-9a-f]{64}$ ]]
sudo -n -u postgres dropdb --if-exists "$rehearsal"
sudo -n -u postgres createdb --template=template0 "$rehearsal"
sudo -n -u postgres pg_restore --exit-on-error --no-owner --no-privileges --dbname="$rehearsal" "$backup"
before_counts="$(counts "$rehearsal")"
before_sums="$(sums "$rehearsal")"
apply "$rehearsal"
test "$(counts "$rehearsal")" = "$before_counts"
test "$(sums "$rehearsal")" = "$before_sums"
apply "$rehearsal"
sudo -n -u postgres dropdb "$rehearsal"
before_counts="$(counts "$db")"
before_sums="$(sums "$db")"
apply "$db"
test "$(counts "$db")" = "$before_counts"
test "$(sums "$db")" = "$before_sums"
apply "$db"
test "$(counts "$db")" = "$before_counts"
test "$(sums "$db")" = "$before_sums"
echo "MIGRATION=170"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_SHA256=$checksum"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "FINANCIAL_AND_STOCK_SUMS_UNCHANGED=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
