#!/usr/bin/env bash
set -euo pipefail
source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"
db="npp_production"
migration_id="167_manual_inbound_document_numbers"
predecessor_id="166_inventory_adjustment_signed_system_snapshot"
required_inventory_id="143_inventory_adjustment_reconciliation_batch"
migration_sql="/tmp/npp-167-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-167.dump"
runtime_role="npp_company_runtime"

sudo -n true
for utility in psql pg_dump pg_restore createdb dropdb sha256sum; do
  command -v "$utility" >/dev/null
done
test -s "$migration_sql"
chmod 0644 "$migration_sql"
cleanup() {
  sudo -n -u postgres dropdb --if-exists "$rehearsal" >/dev/null 2>&1 || true
  rm -f "$migration_sql" || true
}
trap cleanup EXIT
scalar() {
  sudo -n -u postgres psql -XAt -v ON_ERROR_STOP=1 -d "$1" -c "$2"
}
protected_counts() {
  scalar "$1" "SELECT 'adjustments='||count(*) FROM inventory.inventory_adjustments
    UNION ALL SELECT 'adjustment_lines='||count(*) FROM inventory.inventory_adjustment_lines
    UNION ALL SELECT 'inventory_movements='||count(*) FROM inventory.inventory_movements
    UNION ALL SELECT 'inventory_movement_lines='||count(*) FROM inventory.inventory_movement_lines
    UNION ALL SELECT 'inventory_balances='||count(*) FROM inventory.inventory_balances
    UNION ALL SELECT 'sales_orders='||count(*) FROM sales.sales_orders
    ORDER BY 1"
}
snapshot_sums() {
  scalar "$1" "SELECT
    (SELECT coalesce(sum(system_base_quantity_snapshot),0)::text FROM inventory.inventory_adjustment_lines)||'|'||
    (SELECT coalesce(sum(counted_base_quantity_snapshot),0)::text FROM inventory.inventory_adjustment_lines)||'|'||
    (SELECT coalesce(sum(on_hand_quantity),0)::text FROM inventory.inventory_balances)"
}
verify_target() {
  local target="$1" applied docs numbered allocations duplicates role_check
  applied="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
  docs="$(scalar "$target" "SELECT count(*) FROM inventory.manual_inbound_documents")"
  numbered="$(scalar "$target" "SELECT count(*) FROM inventory.manual_inbound_document_numbers")"
  allocations="$(scalar "$target" "SELECT count(*) FROM shared.document_number_allocations WHERE id IN (
    SELECT number_allocation_id FROM inventory.manual_inbound_document_numbers)")"
  duplicates="$(scalar "$target" "SELECT count(*) FROM (
    SELECT installation_id, document_number FROM inventory.manual_inbound_document_numbers
    GROUP BY installation_id, document_number HAVING count(*) > 1) invalid")"
  role_check="REHEARSAL_NO_GRANTS"
  if [ "$target" = "$db" ]; then
    role_check="$(scalar "$target" "SELECT CASE WHEN has_table_privilege('${runtime_role}', 'inventory.manual_inbound_document_numbers', 'SELECT,INSERT') THEN 1 ELSE 0 END")"
    test "$role_check" = 1
  fi
  echo "MIGRATION_TARGET=$target REGISTRY=$applied DOCUMENTS=$docs NUMBERED=$numbered ALLOCATIONS=$allocations DUPLICATES=$duplicates RUNTIME_PRIVILEGES=$role_check"
  test "$applied" = 1
  test "$docs" = "$numbered"
  test "$docs" = "$allocations"
  test "$duplicates" = 0
}

apply_migration() {
  local target="$1"
  if [ "$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")" = 1 ]; then
    verify_target "$target"
    return
  fi
  sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -d "$target" >/dev/null \
    -v migration_id="$migration_id" -v migration_sql="$migration_sql" <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
\i :migration_sql
INSERT INTO shared.schema_migrations (id) VALUES (:'migration_id')
  ON CONFLICT (id) DO NOTHING;
COMMIT;
SQL
}
test "$(scalar postgres "SELECT count(*) FROM pg_database WHERE datname='${db}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='${required_inventory_id}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='${predecessor_id}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")" = 1
already="$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
if [ "$already" = 1 ]; then
  verify_target "$db"
  echo "MIGRATION=167"
  echo "SOURCE_SHA=$source_sha"
  echo "PRODUCTION_MIGRATION=ALREADY_APPLIED"
  echo "PRODUCTION_VERIFY=PASS"
  exit 0
fi
test "$already" = 0
test "$(scalar "$db" "SELECT count(*) FROM pg_tables WHERE schemaname='inventory' AND tablename='manual_inbound_documents'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM pg_tables WHERE schemaname='shared' AND tablename='document_number_allocations'")" = 1
db_bytes="$(scalar postgres "SELECT pg_database_size('${db}')")"
free_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
free_bytes=$((free_kb * 1024))
test "$db_bytes" -gt 0
test "$free_bytes" -gt "$((db_bytes * 2))"
sudo -n install -d -o postgres -g postgres -m 0700 "$backup_dir"
sudo -n -u postgres pg_dump -Fc -d "$db" -f "$backup_file"
backup_bytes="$(sudo -n stat -c '%s' "$backup_file")"
test "$backup_bytes" -gt 0
backup_sha256="$(sudo -n -u postgres sha256sum "$backup_file" | awk '{print $1}')"
[[ "$backup_sha256" =~ ^[0-9a-f]{64}$ ]]

sudo -n -u postgres dropdb --if-exists "$rehearsal"
sudo -n -u postgres createdb --template=template0 "$rehearsal"
sudo -n -u postgres pg_restore --exit-on-error --no-owner --no-privileges --dbname="$rehearsal" "$backup_file"
before_rehearsal="$(protected_counts "$rehearsal")"
sums_rehearsal="$(snapshot_sums "$rehearsal")"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_counts "$rehearsal")" = "$before_rehearsal"
test "$(snapshot_sums "$rehearsal")" = "$sums_rehearsal"
apply_migration "$rehearsal"
test "$(protected_counts "$rehearsal")" = "$before_rehearsal"
sudo -n -u postgres dropdb "$rehearsal"

before_production="$(protected_counts "$db")"
sums_production="$(snapshot_sums "$db")"
apply_migration "$db"
verify_target "$db"
test "$(protected_counts "$db")" = "$before_production"
test "$(snapshot_sums "$db")" = "$sums_production"
apply_migration "$db"
test "$(protected_counts "$db")" = "$before_production"
test "$(snapshot_sums "$db")" = "$sums_production"

echo "MIGRATION=167"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_SHA256=$backup_sha256"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "STOCK_QUANTITY_SUMS_UNCHANGED=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
