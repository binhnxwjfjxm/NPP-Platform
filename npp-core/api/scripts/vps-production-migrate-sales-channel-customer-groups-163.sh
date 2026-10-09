#!/usr/bin/env bash
set -euo pipefail

source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"

db="npp_production"
predecessor_id="162_customer_ordering_home_program_content"
migration_id="163_sales_channel_customer_group_eligibility"
runtime_role="npp_company_runtime"
migration_sql="/tmp/npp-163-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-163.dump"

sudo -n true
for command_name in psql pg_dump pg_restore createdb dropdb; do
  command -v "$command_name" >/dev/null
done
test -s "$migration_sql"
chmod 0644 "$migration_sql"

cleanup() {
  sudo -n -u postgres dropdb --if-exists "$rehearsal" >/dev/null 2>&1 || true
  rm -f "$migration_sql" || true
}
trap cleanup EXIT

scalar() {
  local target="$1"
  local query="$2"
  sudo -n -u postgres psql -XAt -d "$target" -c "$query"
}

protected_row_count() {
  scalar "$1" "SELECT 'employees='||count(*) FROM shared.employees
    UNION ALL SELECT 'security_owner_bindings='||count(*) FROM shared.security_owner_bindings
    UNION ALL SELECT 'users='||count(*) FROM shared.users
    UNION ALL SELECT 'customers='||count(*) FROM shared.customers
    UNION ALL SELECT 'customer_groups='||count(*) FROM shared.customer_groups
    UNION ALL SELECT 'sales_channels='||count(*) FROM shared.sales_channels
    UNION ALL SELECT 'price_lists='||count(*) FROM shared.price_lists
    UNION ALL SELECT 'price_list_items='||count(*) FROM shared.price_list_items
    ORDER BY 1"
}

verify_target() {
  local target="$1"
  local registry table_exists fk_count index_count runtime_role_count runtime_privilege

  registry="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
  table_exists="$(scalar "$target" "SELECT CASE WHEN to_regclass('shared.sales_channel_customer_groups') IS NULL THEN 0 ELSE 1 END")"
  test "$table_exists" = 1
  fk_count="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE conrelid='shared.sales_channel_customer_groups'::regclass
      AND contype='f' AND conname IN ('sales_channel_group_channel_fk','sales_channel_group_group_fk')")"
  index_count="$(scalar "$target" "SELECT count(*) FROM pg_indexes
    WHERE schemaname='shared' AND tablename='sales_channel_customer_groups'
      AND indexname='sales_channel_group_customer_idx'")"
  runtime_role_count="$(scalar "$target" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")"
  runtime_privilege="$(scalar "$target" "SELECT CASE WHEN has_table_privilege('${runtime_role}',
    'shared.sales_channel_customer_groups','SELECT,INSERT,UPDATE,DELETE') THEN 1 ELSE 0 END")"
  echo "VERIFY_TARGET=$target REGISTRY=$registry TABLE=$table_exists FOREIGN_KEYS=$fk_count INDEX=$index_count RUNTIME_ROLE=$runtime_role_count RUNTIME_PRIVILEGE=$runtime_privilege"
  test "$registry" = 1
  test "$fk_count" = 2
  test "$index_count" = 1
  test "$runtime_role_count" = 1
  test "$runtime_privilege" = 1
}

# Pricing eligibility must be configured explicitly; never guess group access.
price_gate() {
  local missing
  missing="$(scalar "$db" "SELECT count(DISTINCT pl.id)
    FROM shared.price_lists pl
    JOIN shared.price_list_items pi
      ON pi.installation_id=pl.installation_id AND pi.price_list_id=pl.id
    WHERE pl.list_type='CHANNEL' AND pl.is_active AND pi.is_active
      AND (pl.effective_from IS NULL OR pl.effective_from<=now())
      AND (pl.effective_to IS NULL OR pl.effective_to>now())
      AND NOT EXISTS (
        SELECT 1 FROM shared.sales_channel_customer_groups mapping
        WHERE mapping.installation_id=pl.installation_id AND mapping.channel_id=pl.channel_id
      )")"
  echo "ACTIVE_CHANNEL_PRICE_LISTS_WITHOUT_ELIGIBILITY=$missing"
  if [ "$missing" -gt 0 ]; then
    echo "COMPANY_ROLLOUT_PRICE_GATE=REQUIRES_EXPLICIT_GROUP_ASSIGNMENTS"
  else
    echo "COMPANY_ROLLOUT_PRICE_GATE=PASS"
  fi
}

apply_migration() {
  local target="$1"
  sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -d "$target" >/dev/null \
    -v migration_id="$migration_id" \
    -v migration_sql="$migration_sql" <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
\i :migration_sql
SELECT shared.grant_company_runtime_access('npp_company_runtime'::name);
INSERT INTO shared.schema_migrations (id)
VALUES (:'migration_id')
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
  echo "MIGRATION=163"
  echo "SOURCE_SHA=$source_sha"
  echo "PRODUCTION_MIGRATION=ALREADY_APPLIED"
  echo "PRODUCTION_VERIFY=PASS"
  price_gate
  exit 0
fi
test "$already" = 0

db_bytes="$(scalar postgres "SELECT pg_database_size('${db}')")"
free_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
free_bytes=$((free_kb * 1024))
required_bytes=$((db_bytes * 2))
test "$db_bytes" -gt 0
test "$free_bytes" -gt "$required_bytes"

sudo -n install -d -o postgres -g postgres -m 0700 "$backup_dir"
sudo -n -u postgres pg_dump -Fc -d "$db" -f "$backup_file"
backup_bytes="$(sudo -n stat -c '%s' "$backup_file")"
test "$backup_bytes" -gt 0
backup_sha256="$(sudo -n -u postgres sha256sum "$backup_file" | awk '{print $1}')"
[[ "$backup_sha256" =~ ^[a-f0-9]{64}$ ]]

sudo -n -u postgres dropdb --if-exists "$rehearsal"
sudo -n -u postgres createdb --template=template0 "$rehearsal"
sudo -n -u postgres pg_restore --exit-on-error --no-owner --no-privileges --dbname="$rehearsal" "$backup_file"

rehearsal_rows_before="$(protected_row_count "$rehearsal")"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_rows_before"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_rows_before"
sudo -n -u postgres dropdb "$rehearsal"

production_rows_before="$(protected_row_count "$db")"
apply_migration "$db"
verify_target "$db"
test "$(protected_row_count "$db")" = "$production_rows_before"

apply_migration "$db"
verify_target "$db"
test "$(protected_row_count "$db")" = "$production_rows_before"

echo "MIGRATION=163"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_SHA256=$backup_sha256"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"

price_gate
