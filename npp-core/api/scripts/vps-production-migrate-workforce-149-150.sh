#!/usr/bin/env bash
set -euo pipefail

source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"

db="npp_production"
predecessor_id="148_workforce_attendance_movement"
migration_149="149_workforce_employee_history"
migration_150="150_workforce_organization_structure"
runtime_role="npp_company_runtime"
migration_149_sql="/tmp/npp-149-${source_sha}.sql"
migration_150_sql="/tmp/npp-150-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-149-150.dump"

sudo -n true
for command_name in psql pg_dump pg_restore createdb dropdb; do
  command -v "$command_name" >/dev/null
done
test -s "$migration_149_sql"
test -s "$migration_150_sql"
chmod 0644 "$migration_149_sql" "$migration_150_sql"

cleanup() {
  sudo -n -u postgres dropdb --if-exists "$rehearsal" >/dev/null 2>&1 || true
  rm -f "$migration_149_sql" "$migration_150_sql" || true
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
    UNION ALL SELECT 'leave_requests='||count(*) FROM shared.leave_requests
    UNION ALL SELECT 'attendance_violation_cases='||count(*) FROM shared.attendance_violation_cases
    ORDER BY 1"
}

workforce_history_count() {
  local target="$1"
  local employments assignments departments positions
  employments="$(scalar "$target" "SELECT count(*) FROM shared.employee_employments")"
  assignments="$(scalar "$target" "SELECT count(*) FROM shared.employee_assignments")"
  departments="$(scalar "$target" "SELECT count(*) FROM shared.hr_departments")"
  positions="$(scalar "$target" "SELECT count(*) FROM shared.hr_positions")"
  printf '%s:%s:%s:%s\n' "$employments" "$assignments" "$departments" "$positions"
}

verify_target() {
  local target="$1"
  local registry tables assignment_columns indexes constraints runtime_role_count runtime_privileges
  local missing_employments missing_assignments

  registry="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id IN ('${migration_149}','${migration_150}')")"
  tables="$(scalar "$target" "SELECT count(*) FROM (VALUES
    (to_regclass('shared.employee_employments')),
    (to_regclass('shared.employee_assignments')),
    (to_regclass('shared.hr_departments')),
    (to_regclass('shared.hr_positions'))
  ) AS t(rel) WHERE rel IS NOT NULL")"
  assignment_columns="$(scalar "$target" "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='shared' AND table_name='employee_assignments'
      AND column_name IN ('department_id','position_id','manager_employee_id')")"
  indexes="$(scalar "$target" "SELECT count(*) FROM pg_indexes WHERE schemaname='shared' AND indexname IN (
    'employee_employments_one_open_idx',
    'employee_employments_lookup_idx',
    'employee_assignments_one_open_idx',
    'employee_assignments_lookup_idx',
    'employee_assignments_branch_date_idx',
    'hr_departments_parent_idx',
    'hr_positions_department_idx',
    'employee_assignments_department_date_idx',
    'employee_assignments_position_date_idx',
    'employee_assignments_manager_date_idx'
  )")"
  constraints="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE conrelid='shared.employee_assignments'::regclass
      AND conname IN (
        'employee_assignments_department_fk',
        'employee_assignments_position_fk',
        'employee_assignments_manager_fk',
        'employee_assignments_manager_not_self'
      )")"
  runtime_role_count="$(scalar "$target" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")"
  runtime_privileges="$(scalar "$target" "SELECT count(*) FROM (VALUES
    ('shared.employee_employments'::regclass),
    ('shared.employee_assignments'::regclass),
    ('shared.hr_departments'::regclass),
    ('shared.hr_positions'::regclass)
  ) AS t(rel) WHERE has_table_privilege('${runtime_role}', rel, 'SELECT,INSERT,UPDATE,DELETE')")"
  missing_employments="$(scalar "$target" "SELECT count(*) FROM shared.employees e
    WHERE NOT EXISTS (
      SELECT 1 FROM shared.employee_employments h
      WHERE h.installation_id=e.installation_id AND h.employee_id=e.id
    )")"
  missing_assignments="$(scalar "$target" "SELECT count(*) FROM shared.employees e
    WHERE NOT EXISTS (
      SELECT 1 FROM shared.employee_assignments a
      WHERE a.installation_id=e.installation_id AND a.employee_id=e.id
    )")"

  echo "VERIFY_TARGET=$target REGISTRY=$registry TABLES=$tables ASSIGNMENT_COLUMNS=$assignment_columns INDEXES=$indexes CONSTRAINTS=$constraints RUNTIME_ROLE=$runtime_role_count RUNTIME_PRIVILEGES=$runtime_privileges/4 MISSING_EMPLOYMENTS=$missing_employments MISSING_ASSIGNMENTS=$missing_assignments"

  test "$registry" = 2
  test "$tables" = 4
  test "$assignment_columns" = 3
  test "$indexes" = 10
  test "$constraints" = 4
  test "$runtime_role_count" = 1
  test "$runtime_privileges" = 4
  test "$missing_employments" = 0
  test "$missing_assignments" = 0
}

apply_bundle() {
  local target="$1"
  sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -d "$target" >/dev/null \
    -v migration_149="$migration_149" \
    -v migration_150="$migration_150" \
    -v migration_149_sql="$migration_149_sql" \
    -v migration_150_sql="$migration_150_sql" <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
\i :migration_149_sql
\i :migration_150_sql
SELECT shared.grant_company_runtime_access('npp_company_runtime'::name);
INSERT INTO shared.schema_migrations (id)
VALUES (:'migration_149'), (:'migration_150')
ON CONFLICT (id) DO NOTHING;
COMMIT;
SQL
}

test "$(scalar postgres "SELECT count(*) FROM pg_database WHERE datname='${db}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='${predecessor_id}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")" = 1

already="$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id IN ('${migration_149}','${migration_150}')")"
if [ "$already" = 2 ]; then
  verify_target "$db"
  echo "MIGRATIONS=149,150"
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
rehearsal_history_rows="$(workforce_history_count "$rehearsal")"
apply_bundle "$rehearsal"
verify_target "$rehearsal"
test "$(workforce_history_count "$rehearsal")" = "$rehearsal_history_rows"
sudo -n -u postgres dropdb "$rehearsal"

production_protected_before="$(protected_row_count "$db")"
apply_bundle "$db"
verify_target "$db"
production_protected_after="$(protected_row_count "$db")"
test "$production_protected_after" = "$production_protected_before"

production_history_rows="$(workforce_history_count "$db")"
apply_bundle "$db"
verify_target "$db"
test "$(workforce_history_count "$db")" = "$production_history_rows"
test "$(protected_row_count "$db")" = "$production_protected_after"

echo "MIGRATIONS=149,150"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "WORKFORCE_HISTORY_RERUN_STABLE=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
