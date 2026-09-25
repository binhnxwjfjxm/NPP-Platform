#!/usr/bin/env bash
set -euo pipefail

source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"

db="npp_production"
predecessor_id="158_workforce_attendance_method_combinations"
migration_id="159_workforce_manual_attendance_leave"
runtime_role="npp_company_runtime"
migration_sql="/tmp/npp-159-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-159.dump"

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
  scalar "$1" "SELECT 'attendance_events='||count(*) FROM shared.attendance_events
    UNION ALL SELECT 'employees='||count(*) FROM shared.employees
    UNION ALL SELECT 'leave_requests='||count(*) FROM shared.leave_requests
    UNION ALL SELECT 'leave_balance_entries='||count(*) FROM shared.leave_balance_entries
    ORDER BY 1"
}

leave_status_distribution() {
  scalar "$1" "SELECT status||'='||count(*) FROM shared.leave_requests GROUP BY status ORDER BY status"
}

verify_target() {
  local target="$1"
  local registry source_column approver_column requester_nullable source_constraint runtime_role_count runtime_privilege

  registry="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
  source_column="$(scalar "$target" "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='shared' AND table_name='leave_requests' AND column_name='request_source'
      AND is_nullable='NO' AND column_default LIKE '%SELF_SERVICE%'")"
  approver_column="$(scalar "$target" "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='shared' AND table_name='leave_requests' AND column_name='manual_approver_name'")"
  requester_nullable="$(scalar "$target" "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='shared' AND table_name='leave_requests' AND column_name='requested_by_employee_id'
      AND is_nullable='YES'")"
  source_constraint="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE conname='leave_requests_request_source_check'
      AND conrelid='shared.leave_requests'::regclass
      AND pg_get_constraintdef(oid) LIKE '%SELF_SERVICE%'
      AND pg_get_constraintdef(oid) LIKE '%MANUAL_PAPER%'")"
  runtime_role_count="$(scalar "$target" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")"
  runtime_privilege="$(scalar "$target" "SELECT CASE WHEN has_table_privilege('${runtime_role}', 'shared.leave_requests', 'SELECT,INSERT,UPDATE,DELETE') THEN 1 ELSE 0 END")"

  echo "VERIFY_TARGET=$target REGISTRY=$registry SOURCE_COLUMN=$source_column APPROVER_COLUMN=$approver_column REQUESTER_NULLABLE=$requester_nullable SOURCE_CONSTRAINT=$source_constraint RUNTIME_ROLE=$runtime_role_count RUNTIME_PRIVILEGE=$runtime_privilege"

  test "$registry" = 1
  test "$source_column" = 1
  test "$approver_column" = 1
  test "$requester_nullable" = 1
  test "$source_constraint" = 1
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
  echo "MIGRATION=159"
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
rehearsal_status_before="$(leave_status_distribution "$rehearsal")"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_rows_before"
test "$(leave_status_distribution "$rehearsal")" = "$rehearsal_status_before"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_rows_before"
test "$(leave_status_distribution "$rehearsal")" = "$rehearsal_status_before"
sudo -n -u postgres dropdb "$rehearsal"

production_rows_before="$(protected_row_count "$db")"
production_status_before="$(leave_status_distribution "$db")"
apply_migration "$db"
verify_target "$db"
test "$(protected_row_count "$db")" = "$production_rows_before"
test "$(leave_status_distribution "$db")" = "$production_status_before"

apply_migration "$db"
verify_target "$db"
test "$(protected_row_count "$db")" = "$production_rows_before"
test "$(leave_status_distribution "$db")" = "$production_status_before"

echo "MIGRATION=159"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "LEAVE_STATUS_DISTRIBUTION_UNCHANGED=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
