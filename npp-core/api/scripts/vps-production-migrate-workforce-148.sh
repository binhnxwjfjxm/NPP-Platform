#!/usr/bin/env bash
set -euo pipefail

source_sha="${1:?source_sha_required}"
run_id="${2:?run_id_required}"

db="npp_production"
migration_id="148_workforce_attendance_movement"
predecessor_id="147_workforce_violation_handling"
runtime_role="npp_company_runtime"
migration_sql="/tmp/npp-148-${source_sha}.sql"
rehearsal="npp_migration_rehearsal_${run_id}"
backup_dir="/var/backups/npp/migrations"
backup_file="${backup_dir}/${source_sha}-${run_id}-148.dump"

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
    UNION ALL SELECT 'work_schedules='||count(*) FROM shared.work_schedules
    ORDER BY 1"
}

runtime_table_privileges() {
  local target="$1"
  scalar "$target" "SELECT count(*) FROM (VALUES
    ('shared.work_policies'::regclass),
    ('shared.attendance_events'::regclass)
  ) AS t(rel)
  WHERE has_table_privilege('${runtime_role}', rel, 'SELECT,INSERT,UPDATE,DELETE')"
}

verify_target() {
  local target="$1"
  local registry columns constraints invalid_policy_rows invalid_event_rows runtime_role_count runtime_privileges
  registry="$(scalar "$target" "SELECT count(*) FROM shared.schema_migrations WHERE id='${migration_id}'")"
  columns="$(scalar "$target" "SELECT count(*) FROM information_schema.columns
    WHERE table_schema='shared'
      AND ((table_name='work_policies' AND column_name='attendance_basis' AND is_nullable='NO')
        OR (table_name='attendance_events' AND column_name='movement_reason'))")"
  constraints="$(scalar "$target" "SELECT count(*) FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='shared'
      AND c.conname IN (
        'work_policies_attendance_basis_check',
        'work_policies_no_attendance_check',
        'attendance_events_event_type_check',
        'attendance_events_movement_reason_check',
        'attendance_events_other_reason_note_check'
      )")"
  invalid_policy_rows="$(scalar "$target" "SELECT count(*) FROM shared.work_policies
    WHERE attendance_basis IS NULL
       OR attendance_basis NOT IN ('TIME','PRESENCE','NONE')
       OR (attendance_method='NONE' AND attendance_basis<>'NONE')
       OR (attendance_method<>'NONE' AND attendance_basis='NONE')
       OR (time_mode='NO_ATTENDANCE' AND (attendance_method<>'NONE' OR attendance_basis<>'NONE'))")"
  invalid_event_rows="$(scalar "$target" "SELECT count(*) FROM shared.attendance_events
    WHERE event_type NOT IN ('CHECK_IN','TEMP_EXIT','RETURN','CHECK_OUT')
       OR (event_type='TEMP_EXIT' AND movement_reason NOT IN ('WORK_BUSINESS','PERSONAL','BREAK','OTHER'))
       OR (event_type<>'TEMP_EXIT' AND movement_reason IS NOT NULL)
       OR (movement_reason='OTHER' AND (note IS NULL OR char_length(btrim(note)) NOT BETWEEN 1 AND 1024))")"
  runtime_role_count="$(scalar "$target" "SELECT count(*) FROM pg_roles WHERE rolname='${runtime_role}'")"
  runtime_privileges="$(runtime_table_privileges "$target")"

  echo "VERIFY_TARGET=$target REGISTRY=$registry COLUMNS=$columns CONSTRAINTS=$constraints INVALID_POLICY_ROWS=$invalid_policy_rows INVALID_EVENT_ROWS=$invalid_event_rows RUNTIME_ROLE=$runtime_role_count RUNTIME_PRIVILEGES=$runtime_privileges/2"

  test "$registry" = 1
  test "$columns" = 2
  test "$constraints" = 5
  test "$invalid_policy_rows" = 0
  test "$invalid_event_rows" = 0
  test "$runtime_role_count" = 1
  test "$runtime_privileges" = 2
}

apply_exact_migration() {
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
  echo "MIGRATION_ID=$migration_id"
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
apply_exact_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_rows_before"
apply_exact_migration "$rehearsal"
verify_target "$rehearsal"
test "$(protected_row_count "$rehearsal")" = "$rehearsal_rows_before"
sudo -n -u postgres dropdb "$rehearsal"

production_rows_before="$(protected_row_count "$db")"
apply_exact_migration "$db"
verify_target "$db"
production_rows_after="$(protected_row_count "$db")"
test "$production_rows_after" = "$production_rows_before"

apply_exact_migration "$db"
verify_target "$db"
test "$(protected_row_count "$db")" = "$production_rows_after"

echo "MIGRATION_ID=$migration_id"
echo "SOURCE_SHA=$source_sha"
echo "BACKUP_BYTES=$backup_bytes"
echo "BACKUP_LOCATION=DB_VPS_LOCAL"
echo "RESTORE_REHEARSAL=PASS"
echo "PROTECTED_ROWS_UNCHANGED=PASS"
echo "RUNTIME_PRIVILEGES=PASS"
echo "PRODUCTION_MIGRATION=APPLIED"
echo "PRODUCTION_RERUN_NOOP=PASS"
echo "PRODUCTION_VERIFY=PASS"
