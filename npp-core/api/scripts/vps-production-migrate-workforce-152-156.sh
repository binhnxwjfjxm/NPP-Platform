#!/usr/bin/env bash
set -euo pipefail

source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"

db="npp_production"
predecessor_id="151_workforce_schedule_planning"
runtime_role="npp_company_runtime"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-152-156.dump"

declare -a migration_ids=(
  "152_workforce_leave_balance_ledger"
  "153_workforce_overtime_closeout"
  "154_workforce_payroll_foundation"
  "155_workforce_payroll_aggregation"
  "156_workforce_payroll_closeout"
)
declare -a migration_sqls=(
  "/tmp/npp-152-${source_sha}.sql"
  "/tmp/npp-153-${source_sha}.sql"
  "/tmp/npp-154-${source_sha}.sql"
  "/tmp/npp-155-${source_sha}.sql"
  "/tmp/npp-156-${source_sha}.sql"
)

sudo -n true
for command_name in psql pg_dump pg_restore createdb dropdb; do
  command -v "$command_name" >/dev/null
done
for file in "${migration_sqls[@]}"; do
  test -s "$file"
  chmod 0644 "$file"
done

cleanup() {
  sudo -n -u postgres dropdb --if-exists "$rehearsal" >/dev/null 2>&1 || true
  rm -f "${migration_sqls[@]}" || true
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
    UNION ALL SELECT 'leave_types='||count(*) FROM shared.leave_types
    UNION ALL SELECT 'work_schedules='||count(*) FROM shared.work_schedules
    UNION ALL SELECT 'attendance_violation_cases='||count(*) FROM shared.attendance_violation_cases
    UNION ALL SELECT 'employee_employments='||count(*) FROM shared.employee_employments
    UNION ALL SELECT 'employee_assignments='||count(*) FROM shared.employee_assignments
    ORDER BY 1"
}

new_history_count() {
  scalar "$1" "SELECT 'leave_balance_ledger='||count(*) FROM shared.leave_balance_ledger
    UNION ALL SELECT 'overtime_requests='||count(*) FROM shared.overtime_requests
    UNION ALL SELECT 'attendance_periods='||count(*) FROM shared.attendance_periods
    UNION ALL SELECT 'attendance_period_snapshots='||count(*) FROM shared.attendance_period_snapshots
    UNION ALL SELECT 'payroll_periods='||count(*) FROM shared.payroll_periods
    UNION ALL SELECT 'payroll_salary_profiles='||count(*) FROM shared.payroll_salary_profiles
    UNION ALL SELECT 'payroll_component_types='||count(*) FROM shared.payroll_component_types
    UNION ALL SELECT 'payroll_employee_fixed_components='||count(*) FROM shared.payroll_employee_fixed_components
    UNION ALL SELECT 'payroll_period_components='||count(*) FROM shared.payroll_period_components
    UNION ALL SELECT 'payroll_calculation_snapshots='||count(*) FROM shared.payroll_calculation_snapshots
    UNION ALL SELECT 'payroll_close_snapshots='||count(*) FROM shared.payroll_close_snapshots
    UNION ALL SELECT 'payroll_payslip_snapshots='||count(*) FROM shared.payroll_payslip_snapshots
    UNION ALL SELECT 'payroll_adjustments='||count(*) FROM shared.payroll_adjustments
    ORDER BY 1"
}

verify_target() {
  local target="$1"
  local registry tables leave_columns payroll_columns permissions triggers runtime_role_count runtime_privileges

  registry="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id IN (
    '152_workforce_leave_balance_ledger',
    '153_workforce_overtime_closeout',
    '154_workforce_payroll_foundation',
    '155_workforce_payroll_aggregation',
    '156_workforce_payroll_closeout')")"

  tables="$(scalar "$target" "SELECT count(*) FROM (VALUES
    (to_regclass('shared.leave_balance_ledger')),
    (to_regclass('shared.overtime_requests')),
    (to_regclass('shared.attendance_periods')),
    (to_regclass('shared.attendance_period_snapshots')),
    (to_regclass('shared.payroll_periods')),
    (to_regclass('shared.payroll_salary_profiles')),
    (to_regclass('shared.payroll_component_types')),
    (to_regclass('shared.payroll_employee_fixed_components')),
    (to_regclass('shared.payroll_period_components')),
    (to_regclass('shared.payroll_calculation_snapshots')),
    (to_regclass('shared.payroll_close_snapshots')),
    (to_regclass('shared.payroll_payslip_snapshots')),
    (to_regclass('shared.payroll_adjustments'))
  ) AS t(rel) WHERE rel IS NOT NULL")"

  leave_columns="$(scalar "$target" "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='shared'
      AND (
        (table_name='leave_types' AND column_name IN ('tracks_balance','allow_negative_balance'))
        OR
        (table_name='leave_requests' AND column_name IN ('leave_tracks_balance_snapshot','leave_allow_negative_balance_snapshot'))
      )")"

  payroll_columns="$(scalar "$target" "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='shared' AND table_name='payroll_periods'
      AND column_name IN (
        'calculation_revision','calculation_fingerprint','issue_summary',
        'reconciled_fingerprint','reconciled_by_actor_id','reconciled_at','reconciliation_note',
        'closed_calculation_revision','closed_calculation_fingerprint','closed_by_actor_id','closed_at'
      )")"

  permissions="$(scalar "$target" "SELECT count(*) FROM shared.permission_catalog WHERE permission_key IN (
    'core.overtime.self-request','core.overtime.read','core.overtime.approve','core.overtime.confirm',
    'core.attendance.reconcile','core.payroll.read','core.payroll.manage',
    'core.payroll.close','core.payroll.adjust','core.payroll.export'
  )")"

  triggers="$(scalar "$target" "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
    'leave_balance_ledger_append_only',
    'attendance_period_snapshots_append_only',
    'payroll_period_components_append_only',
    'payroll_calculation_snapshots_append_only',
    'payroll_close_snapshots_append_only',
    'payroll_payslip_snapshots_append_only',
    'payroll_adjustments_append_only'
  )")"

  runtime_role_count="$(scalar "$target" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")"
  runtime_privileges="$(scalar "$target" "SELECT count(*) FROM (VALUES
    ('shared.leave_balance_ledger'::regclass),
    ('shared.overtime_requests'::regclass),
    ('shared.attendance_periods'::regclass),
    ('shared.attendance_period_snapshots'::regclass),
    ('shared.payroll_periods'::regclass),
    ('shared.payroll_salary_profiles'::regclass),
    ('shared.payroll_component_types'::regclass),
    ('shared.payroll_employee_fixed_components'::regclass),
    ('shared.payroll_period_components'::regclass),
    ('shared.payroll_calculation_snapshots'::regclass),
    ('shared.payroll_close_snapshots'::regclass),
    ('shared.payroll_payslip_snapshots'::regclass),
    ('shared.payroll_adjustments'::regclass)
  ) AS t(rel) WHERE has_table_privilege('${runtime_role}', rel, 'SELECT,INSERT,UPDATE,DELETE')")"

  echo "VERIFY_TARGET=$target REGISTRY=$registry TABLES=$tables LEAVE_COLUMNS=$leave_columns PAYROLL_COLUMNS=$payroll_columns PERMISSIONS=$permissions TRIGGERS=$triggers RUNTIME_ROLE=$runtime_role_count RUNTIME_PRIVILEGES=$runtime_privileges/13"

  test "$registry" = 5
  test "$tables" = 13
  test "$leave_columns" = 4
  test "$payroll_columns" = 11
  test "$permissions" = 10
  test "$triggers" = 7
  test "$runtime_role_count" = 1
  test "$runtime_privileges" = 13
}

apply_bundle() {
  local target="$1"
  sudo -n -u postgres psql -X -v ON_ERROR_STOP=1 -d "$target" >/dev/null <<SQL
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
\i ${migration_sqls[0]}
\i ${migration_sqls[1]}
\i ${migration_sqls[2]}
\i ${migration_sqls[3]}
\i ${migration_sqls[4]}
SELECT shared.grant_company_runtime_access('npp_company_runtime'::name);
INSERT INTO shared.schema_migrations (id)
VALUES
  ('${migration_ids[0]}'),
  ('${migration_ids[1]}'),
  ('${migration_ids[2]}'),
  ('${migration_ids[3]}'),
  ('${migration_ids[4]}')
ON CONFLICT (id) DO NOTHING;
COMMIT;
SQL
}

test "$(scalar postgres "SELECT count(*) FROM pg_database WHERE datname='${db}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id='${predecessor_id}'")" = 1
test "$(scalar "$db" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")" = 1

already="$(scalar "$db" "SELECT count(*) FROM shared.schema_migrations WHERE id IN (
  '152_workforce_leave_balance_ledger',
  '153_workforce_overtime_closeout',
  '154_workforce_payroll_foundation',
  '155_workforce_payroll_aggregation',
  '156_workforce_payroll_closeout')")"

if [ "$already" = 5 ]; then
  verify_target "$db"
  echo "MIGRATIONS=152,153,154,155,156"
  echo "SOURCE_SHA=$source_sha"
  echo "PRODUCTION_MIGRATION=ALREADY_APPLIED"
  echo "PRODUCTION_VERIFY=PASS"
  exit 0
fi

test "$already" -ge 0
test "$already" -lt 5

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
rehearsal_history="$(new_history_count "$rehearsal")"
apply_bundle "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_protected_before"
test "$(new_history_count "$rehearsal")" = "$rehearsal_history"
sudo -n -u postgres dropdb "$rehearsal"

production_protected_before="$(protected_row_count "$db")"
apply_bundle "$db"
verify_target "$db"
production_protected_after="$(protected_row_count "$db")"
test "$production_protected_after" = "$production_protected_before"
production_history="$(new_history_count "$db")"
apply_bundle "$db"
verify_target "$db"
test "$(protected_row_count "$db")" = "$production_protected_after"
test "$(new_history_count "$db")" = "$production_history"

echo "MIGRATIONS=152,153,154,155,156"
echo "SOURCE_SHA=$source_sha"
echo "PREVIOUSLY_APPLIED_COUNT=$already"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "WORKFORCE_PAYROLL_RERUN_STABLE=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
