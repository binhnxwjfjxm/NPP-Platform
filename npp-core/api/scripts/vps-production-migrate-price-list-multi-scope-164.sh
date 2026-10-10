#!/usr/bin/env bash
set -euo pipefail

source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"

db="npp_production"
predecessor_id="162_customer_ordering_home_program_content"
migration_id="164_price_list_multi_scope"
runtime_role="npp_company_runtime"
migration_sql="/tmp/npp-164-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-164.dump"

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
    UNION ALL SELECT 'price_lists='||count(*) FROM shared.price_lists
    UNION ALL SELECT 'price_list_items='||count(*) FROM shared.price_list_items
    UNION ALL SELECT 'sales_channels='||count(*) FROM shared.sales_channels
    UNION ALL SELECT 'customer_groups='||count(*) FROM shared.customer_groups
    UNION ALL SELECT 'customers='||count(*) FROM shared.customers
    ORDER BY 1"
}

verify_target() {
  local target="$1"
  local registry tables primary_keys foreign_keys indexes runtime_role_count runtime_privilege
  local missing_channel missing_group

  registry="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
  tables="$(scalar "$target" "SELECT count(*) FROM information_schema.tables
    WHERE table_schema='shared' AND table_name IN ('price_list_channels','price_list_customer_groups')")"
  primary_keys="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE contype='p' AND conrelid IN
    ('shared.price_list_channels'::regclass,'shared.price_list_customer_groups'::regclass)")"
  foreign_keys="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE contype='f' AND conrelid IN
    ('shared.price_list_channels'::regclass,'shared.price_list_customer_groups'::regclass)")"
  indexes="$(scalar "$target" "SELECT count(*) FROM pg_indexes
    WHERE schemaname='shared' AND indexname IN
    ('price_list_channels_by_channel_idx','price_list_groups_by_group_idx')")"
  missing_channel="$(scalar "$target" "SELECT count(*) FROM shared.price_lists pl
    WHERE pl.channel_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM shared.price_list_channels scoped
     WHERE scoped.installation_id=pl.installation_id
       AND scoped.price_list_id=pl.id AND scoped.channel_id=pl.channel_id)")"
  missing_group="$(scalar "$target" "SELECT count(*) FROM shared.price_lists pl
    WHERE pl.customer_group_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM shared.price_list_customer_groups scoped
     WHERE scoped.installation_id=pl.installation_id
       AND scoped.price_list_id=pl.id AND scoped.customer_group_id=pl.customer_group_id)")"
  runtime_role_count="$(scalar "$target" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")"
  runtime_privilege="$(scalar "$target" "SELECT CASE WHEN
    has_table_privilege('${runtime_role}','shared.price_list_channels','SELECT,INSERT,UPDATE,DELETE')
    AND has_table_privilege('${runtime_role}','shared.price_list_customer_groups','SELECT,INSERT,UPDATE,DELETE')
    THEN 1 ELSE 0 END")"

  echo "VERIFY_TARGET=$target REGISTRY=$registry TABLES=$tables PK=$primary_keys FK=$foreign_keys INDEXES=$indexes MISSING_CHANNEL=$missing_channel MISSING_GROUP=$missing_group RUNTIME_ROLE=$runtime_role_count RUNTIME_PRIVILEGES=$runtime_privilege"
  test "$registry" = 1
  test "$tables" = 2
  test "$primary_keys" = 2
  test "$foreign_keys" = 4
  test "$indexes" = 2
  test "$missing_channel" = 0
  test "$missing_group" = 0
  test "$runtime_role_count" = 1
  test "$runtime_privilege" = 1
}

apply_migration() {
  local target="$1"
  # The production migration is intentionally not replayable DDL; registry guards
  # the rerun and the verifier checks the complete resulting schema.
  if [ "$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")" = 1 ]; then
    verify_target "$target"
    return
  fi
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
  echo "MIGRATION=164"
  echo "SOURCE_SHA=$source_sha"
  echo "PRODUCTION_MIGRATION=ALREADY_APPLIED"
  echo "PRODUCTION_VERIFY=PASS"
  exit 0
fi
test "$already" = 0
# Guard against a partially applied schema/registry mismatch.
test "$(scalar "$db" "SELECT count(*) FROM information_schema.tables WHERE table_schema='shared' AND table_name IN ('price_list_channels','price_list_customer_groups')")" = 0

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
[[ "$backup_sha256" =~ ^[0-9a-f]{64}$ ]]

sudo -n -u postgres dropdb --if-exists "$rehearsal"
sudo -n -u postgres createdb --template=template0 "$rehearsal"
sudo -n -u postgres pg_restore --exit-on-error --no-owner --no-privileges --dbname="$rehearsal" "$backup_file"

# Reconcile using a single restored snapshot; the live production database may
# legitimately change while backup/restore and verification are running.
rehearsal_rows_before="$(protected_row_count "$rehearsal")"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_rows_before"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_rows_before"
sudo -n -u postgres dropdb "$rehearsal"

# The live database is validated by schema registry, FKs, indexes and complete
# coverage of every pre-existing channel/group selection, not volatile row counts.
apply_migration "$db"
verify_target "$db"
apply_migration "$db"
verify_target "$db"

echo "MIGRATION=164"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_SHA256=$backup_sha256"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "RESTORED_SNAPSHOT_BUSINESS_ROWS_UNCHANGED=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "SCOPE_FK_AND_BACKFILL=PASS"
echo "PRODUCTION_VERIFY=PASS"
