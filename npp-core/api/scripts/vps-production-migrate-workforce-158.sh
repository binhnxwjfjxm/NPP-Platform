#!/usr/bin/env bash
set -euo pipefail

source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"

db="npp_production"
predecessor_id="157_workforce_face_attendance"
migration_id="158_workforce_attendance_method_combinations"
runtime_role="npp_company_runtime"
migration_sql="/tmp/npp-158-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-158.dump"

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
    UNION ALL SELECT 'employee_work_policy_assignments='||count(*) FROM shared.employee_work_policy_assignments
    UNION ALL SELECT 'work_policies='||count(*) FROM shared.work_policies
    ORDER BY 1"
}

policy_method_distribution() {
  scalar "$1" "SELECT attendance_method||'='||count(*) FROM shared.work_policies GROUP BY attendance_method ORDER BY attendance_method"
}

verify_target() {
  local target="$1"
  local registry constraint_count allowed_values runtime_role_count runtime_privilege

  registry="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
  constraint_count="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE conname='work_policies_attendance_method_check'
      AND conrelid='shared.work_policies'::regclass")"
  allowed_values="$(scalar "$target" "SELECT count(*) FROM pg_constraint
    WHERE conname='work_policies_attendance_method_check'
      AND conrelid='shared.work_policies'::regclass
      AND pg_get_constraintdef(oid) LIKE '%QR%'
      AND pg_get_constraintdef(oid) LIKE '%MANUAL%'
      AND pg_get_constraintdef(oid) LIKE '%BOTH%'
      AND pg_get_constraintdef(oid) LIKE '%FACE%'
      AND pg_get_constraintdef(oid) LIKE '%QR_FACE%'
      AND pg_get_constraintdef(oid) LIKE '%FACE_MANUAL%'
      AND pg_get_constraintdef(oid) LIKE '%ALL%'
      AND pg_get_constraintdef(oid) LIKE '%NONE%'")"
  runtime_role_count="$(scalar "$target" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")"
  runtime_privilege="$(scalar "$target" "SELECT CASE WHEN has_table_privilege('${runtime_role}', 'shared.work_policies', 'SELECT,INSERT,UPDATE,DELETE') THEN 1 ELSE 0 END")"

  echo "VERIFY_TARGET=$target REGISTRY=$registry CONSTRAINTS=$constraint_count ALLOWED_VALUES=$allowed_values RUNTIME_ROLE=$runtime_role_count RUNTIME_PRIVILEGE=$runtime_privilege"

  test "$registry" = 1
  test "$constraint_count" = 1
  test "$allowed_values" = 1
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
  echo "MIGRATION=158"
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
rehearsal_methods_before="$(policy_method_distribution "$rehearsal")"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_rows_before"
test "$(policy_method_distribution "$rehearsal")" = "$rehearsal_methods_before"
apply_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_rows_before"
test "$(policy_method_distribution "$rehearsal")" = "$rehearsal_methods_before"
sudo -n -u postgres dropdb "$rehearsal"

production_rows_before="$(protected_row_count "$db")"
production_methods_before="$(policy_method_distribution "$db")"
apply_migration "$db"
verify_target "$db"
test "$(protected_row_count "$db")" = "$production_rows_before"
test "$(policy_method_distribution "$db")" = "$production_methods_before"

apply_migration "$db"
verify_target "$db"
test "$(protected_row_count "$db")" = "$production_rows_before"
test "$(policy_method_distribution "$db")" = "$production_methods_before"

echo "MIGRATION=158"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "POLICY_METHOD_DISTRIBUTION_UNCHANGED=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
