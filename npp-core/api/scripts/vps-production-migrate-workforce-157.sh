#!/usr/bin/env bash
set -euo pipefail

source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"

db="npp_production"
predecessor_id="156_workforce_payroll_closeout"
migration_id="157_workforce_face_attendance"
runtime_role="npp_company_runtime"
migration_sql="/tmp/npp-157-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-157.dump"

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
    UNION ALL SELECT 'work_policies='||count(*) FROM shared.work_policies
    UNION ALL SELECT 'employee_work_policy_assignments='||count(*) FROM shared.employee_work_policy_assignments
    ORDER BY 1"
}

face_row_count() {
  scalar "$1" "SELECT 'attendance_face_devices='||count(*) FROM shared.attendance_face_devices
    UNION ALL SELECT 'employee_face_templates='||count(*) FROM shared.employee_face_templates
    ORDER BY 1"
}

verify_target() {
  local target="$1"
  local registry tables indexes foreign_keys policy_face source_face runtime_role_count runtime_privileges

  registry="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
  tables="$(scalar "$target" "SELECT count(*) FROM (VALUES
    (to_regclass('shared.attendance_face_devices')),
    (to_regclass('shared.employee_face_templates'))
  ) AS t(rel) WHERE rel IS NOT NULL")"
  indexes="$(scalar "$target" "SELECT count(*) FROM pg_indexes WHERE schemaname='shared' AND indexname IN (
    'attendance_face_devices_branch_idx',
    'employee_face_templates_one_active_idx',
    'employee_face_templates_active_model_idx'
  )")"
  foreign_keys="$(scalar "$target" "SELECT count(*) FROM pg_constraint WHERE conname IN (
    'attendance_face_devices_branch_fk',
    'attendance_face_devices_point_fk',
    'employee_face_templates_employee_fk'
  )")"
  policy_face="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE conname='work_policies_attendance_method_check'
      AND pg_get_constraintdef(oid) LIKE '%FACE%'
      AND pg_get_constraintdef(oid) LIKE '%QR_FACE%'")"
  source_face="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE conname='attendance_events_source_check'
      AND pg_get_constraintdef(oid) LIKE '%FACE%'")"
  runtime_role_count="$(scalar "$target" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")"
  runtime_privileges="$(scalar "$target" "SELECT count(*) FROM (VALUES
    ('shared.attendance_face_devices'::regclass),
    ('shared.employee_face_templates'::regclass)
  ) AS t(rel) WHERE has_table_privilege('${runtime_role}', rel, 'SELECT,INSERT,UPDATE,DELETE')")"

  echo "VERIFY_TARGET=$target REGISTRY=$registry TABLES=$tables INDEXES=$indexes FOREIGN_KEYS=$foreign_keys POLICY_FACE=$policy_face SOURCE_FACE=$source_face RUNTIME_ROLE=$runtime_role_count RUNTIME_PRIVILEGES=$runtime_privileges/2"

  test "$registry" = 1
  test "$tables" = 2
  test "$indexes" = 3
  test "$foreign_keys" = 3
  test "$policy_face" = 1
  test "$source_face" = 1
  test "$runtime_role_count" = 1
  test "$runtime_privileges" = 2
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
  echo "MIGRATION=157"
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

rehearsal_protected_before="$(protected_row_count "$rehearsal")"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_protected_before"
rehearsal_face_rows="$(face_row_count "$rehearsal")"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(face_row_count "$rehearsal")" = "$rehearsal_face_rows"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_protected_before"
sudo -n -u postgres dropdb "$rehearsal"

production_protected_before="$(protected_row_count "$db")"
apply_migration "$db"
verify_target "$db"
production_protected_after="$(protected_row_count "$db")"
test "$production_protected_after" = "$production_protected_before"

production_face_rows="$(face_row_count "$db")"
apply_migration "$db"
verify_target "$db"
test "$(face_row_count "$db")" = "$production_face_rows"
test "$(protected_row_count "$db")" = "$production_protected_after"

echo "MIGRATION=157"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "FACE_RERUN_STABLE=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
