#!/usr/bin/env bash
set -euo pipefail
source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"
db="npp_production"
predecessor_id="164_price_list_multi_scope"
migration_id="165_manual_delivery_return_receipts"
runtime_role="npp_company_runtime"
migration_sql="/tmp/npp-165-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-165.dump"

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
  scalar "$1" "SELECT 'orders='||count(*) FROM sales.sales_orders
    UNION ALL SELECT 'issue_movements='||count(*) FROM inventory.inventory_movements
    UNION ALL SELECT 'issue_lines='||count(*) FROM inventory.inventory_movement_lines
    UNION ALL SELECT 'receivables='||count(*) FROM accounting.receivable_documents
    UNION ALL SELECT 'customers='||count(*) FROM shared.customers
    ORDER BY 1"
}
verify_target() {
  local target="$1" applied tables constraints idx triggers privileges rows
  applied="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
  tables="$(scalar "$target" "SELECT count(*) FROM information_schema.tables
    WHERE table_schema='sales' AND table_name IN
    ('manual_delivery_return_receipts','manual_delivery_return_lines')")"
  constraints="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE contype='f' AND conrelid IN
    ('sales.manual_delivery_return_receipts'::regclass,
     'sales.manual_delivery_return_lines'::regclass)")"
  idx="$(scalar "$target" "SELECT count(*) FROM pg_indexes WHERE schemaname='sales'
    AND indexname IN ('manual_delivery_return_receipts_order_idx',
                      'manual_delivery_return_lines_origin_idx')")"
  triggers="$(scalar "$target" "SELECT count(*) FROM pg_trigger
    WHERE NOT tgisinternal AND tgname IN
    ('manual_delivery_return_receipts_guard','manual_delivery_return_lines_guard')
    AND tgfoid = 'sales.guard_manual_delivery_return_receipt()'::regprocedure")"
  privileges="$(scalar "$target" "SELECT CASE WHEN
    has_table_privilege('${runtime_role}', 'sales.manual_delivery_return_receipts', 'SELECT,INSERT,UPDATE,DELETE')
    AND has_table_privilege('${runtime_role}', 'sales.manual_delivery_return_lines', 'SELECT,INSERT,UPDATE,DELETE')
    THEN 1 ELSE 0 END")"
  rows="$(scalar "$target" "SELECT
    (SELECT count(*) FROM sales.manual_delivery_return_receipts)
    + (SELECT count(*) FROM sales.manual_delivery_return_lines)")"
  echo "MIGRATION_TARGET=$target REGISTRY=$applied TABLES=$tables FOREIGN_KEYS=$constraints INDEXES=$idx TRIGGERS=$triggers RUNTIME_PRIVILEGES=$privileges ROWS=$rows"
  test "$applied" = 1
  test "$tables" = 2
  test "$constraints" = 7
  test "$idx" = 2
  test "$triggers" = 2
  test "$privileges" = 1
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
SELECT shared.grant_company_runtime_access('npp_company_runtime'::name);
INSERT INTO shared.schema_migrations (id) VALUES (:'migration_id')
  ON CONFLICT (id) DO NOTHING;
COMMIT;
SQL
}

test "$(scalar postgres "SELECT count(*) FROM pg_database WHERE datname='${db}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='${predecessor_id}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")" = 1
already="$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
if [ "$already" = 1 ]; then
  verify_target "$db"
  echo "MIGRATION=165"
  echo "SOURCE_SHA=$source_sha"
  echo "PRODUCTION_MIGRATION=ALREADY_APPLIED"
  echo "PRODUCTION_VERIFY=PASS"
  exit 0
fi
test "$already" = 0
test "$(scalar "$db" "SELECT count(*) FROM information_schema.tables
  WHERE table_schema='sales' AND table_name IN ('manual_delivery_return_receipts','manual_delivery_return_lines')")" = 0
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
snapshot_before="$(protected_counts "$rehearsal")"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_counts "$rehearsal")" = "$snapshot_before"
apply_migration "$rehearsal"
test "$(protected_counts "$rehearsal")" = "$snapshot_before"
sudo -n -u postgres dropdb "$rehearsal"

apply_migration "$db"
verify_target "$db"
apply_migration "$db"
verify_target "$db"
echo "MIGRATION=165"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_SHA256=$backup_sha256"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "RESTORED_SNAPSHOT_BUSINESS_ROWS_UNCHANGED=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
