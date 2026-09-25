#!/usr/bin/env bash
set -euo pipefail

source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"

db="npp_production"
predecessor_id="159_workforce_manual_attendance_leave"
migration_id="160_retail_web_push_subscriptions"
runtime_role="npp_company_runtime"
migration_sql="/tmp/npp-160-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-160.dump"

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
    ORDER BY 1"
}

verify_target() {
  local target="$1"
  local registry table_exists fk_exists endpoint_hash_column runtime_role_count runtime_privilege

  registry="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
  table_exists="$(scalar "$target" "SELECT count(*) FROM information_schema.tables
    WHERE table_schema='shared' AND table_name='retail_web_push_subscriptions'")"
  endpoint_hash_column="$(scalar "$target" "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='shared' AND table_name='retail_web_push_subscriptions'
      AND column_name='endpoint_hash' AND data_type='character'")"
  fk_exists="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE conname='retail_web_push_subscriptions_user_fk'
      AND conrelid='shared.retail_web_push_subscriptions'::regclass")"
  runtime_role_count="$(scalar "$target" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")"
  runtime_privilege="$(scalar "$target" "SELECT CASE WHEN has_table_privilege('${runtime_role}', 'shared.retail_web_push_subscriptions', 'SELECT,INSERT,UPDATE,DELETE') THEN 1 ELSE 0 END")"

  echo "VERIFY_TARGET=$target REGISTRY=$registry TABLE=$table_exists ENDPOINT_HASH=$endpoint_hash_column FK=$fk_exists RUNTIME_ROLE=$runtime_role_count RUNTIME_PRIVILEGE=$runtime_privilege"

  test "$registry" = 1
  test "$table_exists" = 1
  test "$endpoint_hash_column" = 1
  test "$fk_exists" = 1
  test "$runtime_role_count" = 1
  test "$runtime_privilege" = 1
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
  echo "MIGRATION=160"
  echo "SOURCE_SHA=$source_sha"
  echo "PRODUCTION_MIGRATION=ALREADY_APPLIED"
  echo "PRODUCTION_VERIFY=PASS"
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

echo "MIGRATION=160"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
