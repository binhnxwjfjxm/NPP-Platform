#!/usr/bin/env bash
set -euo pipefail
source_sha="$1"
run_id="$2"
[[ "$source_sha" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ "$run_id" =~ ^[0-9]+$ ]] || exit 2

db=npp_production
migration_id=163_sales_channel_customer_group_eligibility
rehearsal="npp_rollback_163_$run_id"
backup_dir=/var/backups/npp/migrations
backup_file="$backup_dir/$source_sha-$run_id-rollback-163.dump"

sudo -n true
for command_name in psql pg_dump pg_restore createdb dropdb; do
  command -v "$command_name" >/dev/null
done

cleanup() {
  sudo -n -u postgres dropdb --if-exists "$rehearsal" >/dev/null 2>&1 || true
}
trap cleanup EXIT

scalar() {
  sudo -n -u postgres psql -XAt -d "$1" -c "$2"
}

protected_counts() {
  scalar "$1" "SELECT 'customers='||count(*) FROM shared.customers
    UNION ALL SELECT 'customer_groups='||count(*) FROM shared.customer_groups
    UNION ALL SELECT 'sales_channels='||count(*) FROM shared.sales_channels
    UNION ALL SELECT 'price_lists='||count(*) FROM shared.price_lists
    UNION ALL SELECT 'price_list_items='||count(*) FROM shared.price_list_items
    UNION ALL SELECT 'sales_orders='||count(*) FROM sales.sales_orders
    UNION ALL SELECT 'sales_order_versions='||count(*) FROM sales.sales_order_versions
    UNION ALL SELECT 'sales_order_version_lines='||count(*) FROM sales.sales_order_version_lines
    ORDER BY 1"
}

verify_rolled_back() {
  local target="$1"
  local table_count registry_count
  table_count="$(scalar "$target" "SELECT CASE WHEN to_regclass('shared.sales_channel_customer_groups') IS NULL THEN 0 ELSE 1 END")"
  registry_count="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='$migration_id'")"
  echo "VERIFY_TARGET=$target TABLE=$table_count REGISTRY=$registry_count"
  test "$table_count" = 0
  test "$registry_count" = 0
}

rollback_target() {
  local target="$1"
  sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -q -d "$target" <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
LOCK TABLE shared.sales_channel_customer_groups IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE rollback_163_protected_snapshot ON COMMIT DROP AS
  SELECT
    (SELECT count(*) FROM shared.customers) AS customers,
    (SELECT count(*) FROM shared.customer_groups) AS customer_groups,
    (SELECT count(*) FROM shared.sales_channels) AS sales_channels,
    (SELECT count(*) FROM shared.price_lists) AS price_lists,
    (SELECT count(*) FROM shared.price_list_items) AS price_list_items,
    (SELECT count(*) FROM sales.sales_orders) AS sales_orders,
    (SELECT count(*) FROM sales.sales_order_versions) AS sales_order_versions,
    (SELECT count(*) FROM sales.sales_order_version_lines) AS sales_order_version_lines;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM shared.sales_channel_customer_groups) THEN
    RAISE EXCEPTION 'rollback_163_mapping_not_empty';
  END IF;
  IF (SELECT count(*) FROM shared.schema_migrations
      WHERE id='163_sales_channel_customer_group_eligibility') <> 1 THEN
    RAISE EXCEPTION 'rollback_163_registry_mismatch';
  END IF;
END
$guard$;

DROP TABLE shared.sales_channel_customer_groups RESTRICT;
DELETE FROM shared.schema_migrations
 WHERE id='163_sales_channel_customer_group_eligibility';

DO $verify$
DECLARE
  s record;
BEGIN
  SELECT * INTO s FROM rollback_163_protected_snapshot;
  IF to_regclass('shared.sales_channel_customer_groups') IS NOT NULL
     OR EXISTS (SELECT 1 FROM shared.schema_migrations
                WHERE id='163_sales_channel_customer_group_eligibility')
     OR s.customers <> (SELECT count(*) FROM shared.customers)
     OR s.customer_groups <> (SELECT count(*) FROM shared.customer_groups)
     OR s.sales_channels <> (SELECT count(*) FROM shared.sales_channels)
     OR s.price_lists <> (SELECT count(*) FROM shared.price_lists)
     OR s.price_list_items <> (SELECT count(*) FROM shared.price_list_items)
     OR s.sales_orders <> (SELECT count(*) FROM sales.sales_orders)
     OR s.sales_order_versions <> (SELECT count(*) FROM sales.sales_order_versions)
     OR s.sales_order_version_lines <> (SELECT count(*) FROM sales.sales_order_version_lines)
  THEN
    RAISE EXCEPTION 'rollback_163_protected_rows_changed';
  END IF;
END
$verify$;
COMMIT;
SQL
}

test "$(scalar postgres "SELECT count(*) FROM pg_database WHERE datname='$db'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='162_customer_ordering_home_program_content'")" = 1

table_count="$(scalar "$db" "SELECT CASE WHEN to_regclass('shared.sales_channel_customer_groups') IS NULL THEN 0 ELSE 1 END")"
registry_count="$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='$migration_id'")"
if [ "$table_count" = 0 ] && [ "$registry_count" = 0 ]; then
  verify_rolled_back "$db"
  echo 'MIGRATION163_ROLLBACK=ALREADY_APPLIED'
  exit 0
fi
test "$table_count" = 1
test "$registry_count" = 1

mapping_rows="$(scalar "$db" 'SELECT count(*) FROM shared.sales_channel_customer_groups')"
echo "MAPPING_ROWS_BEFORE=$mapping_rows"
if [ "$mapping_rows" != 0 ]; then
  echo 'ROLLBACK163_BLOCKED=NONEMPTY_MAPPING'
  exit 1
fi

db_bytes="$(scalar postgres "SELECT pg_database_size('$db')")"
free_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
test "$db_bytes" -gt 0
test "$((free_kb * 1024))" -gt "$((db_bytes * 2))"

sudo -n install -d -o postgres -g postgres -m 0700 "$backup_dir"
sudo -n -u postgres pg_dump -Fc -d "$db" -f "$backup_file"
backup_bytes="$(sudo -n stat -c '%s' "$backup_file")"
test "$backup_bytes" -gt 0
backup_sha256="$(sudo -n -u postgres sha256sum "$backup_file" | awk '{print $1}')"
[[ "$backup_sha256" =~ ^[a-f0-9]{64}$ ]] || exit 1

sudo -n -u postgres dropdb --if-exists "$rehearsal"
sudo -n -u postgres createdb --template=template0 "$rehearsal"
sudo -n -u postgres pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="$rehearsal" "$backup_file"
before_rehearsal="$(protected_counts "$rehearsal")"
rollback_target "$rehearsal"
verify_rolled_back "$rehearsal"
test "$(protected_counts "$rehearsal")" = "$before_rehearsal"
sudo -n -u postgres dropdb "$rehearsal"

# Production lock + empty-table check are repeated atomically inside rollback_target.
before_production="$(protected_counts "$db")"
echo "PROTECTED_COUNTS_BEFORE_BEGIN"
printf '%s\n' "$before_production"
rollback_target "$db"
verify_rolled_back "$db"
echo "PROTECTED_COUNTS_AFTER_BEGIN"
protected_counts "$db"

echo 'MIGRATION163_ROLLBACK=APPLIED'
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_SHA256=$backup_sha256"
echo 'BACKUP_LOCATION=DB_VPS_LOCAL'
echo 'RESTORE_REHEARSAL=PASS'
echo 'PROTECTED_ROWS_IN_TRANSACTION=UNCHANGED'
echo 'MAPPING_ROWS_REMOVED=0'
echo 'PRODUCTION_REGISTRY163=ABSENT'
echo 'PRODUCTION_TABLE163=ABSENT'
