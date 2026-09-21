#!/usr/bin/env bash
set -euo pipefail

source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"

db="npp_production"
predecessor_id="145_company_runtime_privileges"
migration_146="146_workforce_leave_absence"
migration_147="147_workforce_violation_handling"
runtime_role="npp_company_runtime"
migration_146_sql="/tmp/npp-146-${source_sha}.sql"
migration_147_sql="/tmp/npp-147-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-146-147.dump"

sudo -n true
for command_name in psql pg_dump pg_restore createdb dropdb; do
  command -v "$command_name" >/dev/null
done
test -s "$migration_146_sql"
test -s "$migration_147_sql"
chmod 0644 "$migration_146_sql" "$migration_147_sql"

cleanup() {
  sudo -n -u postgres dropdb --if-exists "$rehearsal" >/dev/null 2>&1 || true
  rm -f "$migration_146_sql" "$migration_147_sql" || true
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
    UNION ALL SELECT 'work_schedules='||count(*) FROM shared.work_schedules
    ORDER BY 1"
}

workflow_row_count() {
  local target="$1"
  local leave_types=0
  local leave_requests=0
  local violation_cases=0
  if [ "$(scalar "$target" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='shared' AND c.relname='leave_types' AND c.relkind='r'")" = 1 ]; then
    leave_types="$(scalar "$target" "SELECT count(*) FROM shared.leave_types")"
  fi
  if [ "$(scalar "$target" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='shared' AND c.relname='leave_requests' AND c.relkind='r'")" = 1 ]; then
    leave_requests="$(scalar "$target" "SELECT count(*) FROM shared.leave_requests")"
  fi
  if [ "$(scalar "$target" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='shared' AND c.relname='attendance_violation_cases' AND c.relkind='r'")" = 1 ]; then
    violation_cases="$(scalar "$target" "SELECT count(*) FROM shared.attendance_violation_cases")"
  fi
  printf '%s:%s:%s
' "$leave_types" "$leave_requests" "$violation_cases"
}

verify_target() {
  local target="$1"
  local registry tables permissions indexes runtime_role_count runtime_privileges
  registry="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id IN ('${migration_146}','${migration_147}')")"
  tables="$(scalar "$target" "SELECT count(*) FROM (VALUES
    (to_regclass('shared.leave_types')),
    (to_regclass('shared.leave_requests')),
    (to_regclass('shared.attendance_violation_cases'))
  ) AS t(rel) WHERE rel IS NOT NULL")"
  permissions="$(scalar "$target" "SELECT count(*) FROM shared.permission_catalog WHERE permission_key IN (
    'core.leave.self.read','core.leave.self.request','core.leave.read','core.leave.approve','core.leave-type.manage',
    'core.attendance-violation.self-explain','core.attendance-violation.resolve'
  )")"
  indexes="$(scalar "$target" "SELECT count(*) FROM pg_indexes WHERE schemaname='shared' AND indexname IN (
    'leave_types_active_name_idx','leave_requests_employee_period_idx','leave_requests_status_period_idx',
    'leave_requests_type_period_idx','attendance_violation_cases_employee_period_idx',
    'attendance_violation_cases_status_period_idx'
  )")"
  runtime_role_count="$(scalar "$target" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")"
  runtime_privileges="$(scalar "$target" "SELECT count(*) FROM (VALUES
    ('shared.leave_types'::regclass),
    ('shared.leave_requests'::regclass),
    ('shared.attendance_violation_cases'::regclass)
  ) AS t(rel) WHERE has_table_privilege('${runtime_role}', rel, 'SELECT,INSERT,UPDATE,DELETE')")"

  test "$registry" = 2
  test "$tables" = 3
  test "$permissions" = 7
  test "$indexes" = 6
  test "$runtime_role_count" = 1
  test "$runtime_privileges" = 3
}

apply_bundle() {
  local target="$1"
  sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -d "$target" >/dev/null     -v migration_146="$migration_146"     -v migration_147="$migration_147"     -v migration_146_sql="$migration_146_sql"     -v migration_147_sql="$migration_147_sql" <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
\i :migration_146_sql
\i :migration_147_sql
INSERT INTO shared.schema_migrations (id)
VALUES (:'migration_146'), (:'migration_147')
ON CONFLICT (id) DO NOTHING;
COMMIT;
SQL
}

test "$(scalar postgres "SELECT count(*) FROM pg_database WHERE datname='${db}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='${predecessor_id}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")" = 1

already="$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id IN ('${migration_146}','${migration_147}')")"
if [ "$already" = 2 ]; then
  verify_target "$db"
  echo "MIGRATIONS=146,147"
  echo "SOURCE_SHA=$source_sha"
  echo "PRODUCTION_MIGRATION=ALREADY_APPLIED"
  echo "PRODUCTION_VERIFY=PASS"
  exit 0
fi

test "$already" = 0 || test "$already" = 1

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

rehearsal_protected_before="$(protected_row_count "$rehearsal")"
apply_bundle "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_protected_before"
rehearsal_workflow_rows="$(workflow_row_count "$rehearsal")"
apply_bundle "$rehearsal"
verify_target "$rehearsal"
test "$(workflow_row_count "$rehearsal")" = "$rehearsal_workflow_rows"
sudo -n -u postgres dropdb "$rehearsal"

production_protected_before="$(protected_row_count "$db")"
apply_bundle "$db"
verify_target "$db"
production_protected_after="$(protected_row_count "$db")"
test "$production_protected_after" = "$production_protected_before"

production_workflow_rows="$(workflow_row_count "$db")"
apply_bundle "$db"
verify_target "$db"
test "$(workflow_row_count "$db")" = "$production_workflow_rows"
test "$(protected_row_count "$db")" = "$production_protected_after"

echo "MIGRATIONS=146,147"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "WORKFORCE_WORKFLOW_ROWS_STABLE=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
