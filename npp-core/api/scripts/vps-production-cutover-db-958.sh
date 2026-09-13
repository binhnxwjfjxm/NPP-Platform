# sourced by vps-production-cutover-958.sh
# Gate C: freeze all known Heroku writers, final backup/restore/reconciliation to dedicated production DB.
set_web_quantity "$HEROKU_COMPANY_APP" 0
set_web_quantity "$HEROKU_MCP_APP" 0
wait_web_quantity "$HEROKU_COMPANY_APP" 0
wait_web_quantity "$HEROKU_MCP_APP" 0
sleep 5

# Reuse the already-reviewed rehearsal implementation to perform the final restore.
# The raw rehearsal intentionally remains diagnostic because PostgreSQL major-version
# deparsers can differ textually while catalog/data semantics are equivalent. The
# canonical parity gate below is the production authority, matching the owner-approved
# rehearsal contract from Issue #958 / PR #1021.
lib="$RUNNER_TEMP/vps-db-lib.sh"
sed '/^resolve_heroku_database$/,$d' npp-core/api/scripts/vps-db-heroku-rehearsal-958.sh > "$lib"
raw_rehearsal_status=0
if REQUESTED_ACTION=rehearse HEROKU_APP_NAME="$HEROKU_COMPANY_APP" SOURCE_SHA="$CUTOVER_SHA" \
  VPS_DB_HOST="$VPS_DB_HOST" VPS_SSH_USER="$VPS_SSH_USER" SSH_KEY="$DB_KEY" KNOWN_HOSTS="$DB_KNOWN" \
  REPORT_FILE="$RUNNER_TEMP/final-db-reconcile.md" RUNNER_TEMP="$RUNNER_TEMP" bash -c '
    set -euo pipefail
    source "$1"
    restore_db="npp_production"
    backup_file="$RUNNER_TEMP/npp-958-final-${GITHUB_RUN_ID:-local}.dump"
    resolve_heroku_database
    write_snapshot_sql
    migration_head_audit
    test "$(awk -F= '\''$1=="SOURCE_PENDING_CORE_COUNT"{print $2}'\'' "$RUNNER_TEMP/migration-audit.txt")" = 0
    test "$(awk -F= '\''$1=="SOURCE_PENDING_MCP_COUNT"{print $2}'\'' "$RUNNER_TEMP/migration-audit.txt")" = 0
    printf "%s\n" "$backup_file" > "$RUNNER_TEMP/final-backup-path"
    run_rehearsal
  ' _ "$lib"
then
  :
else
  raw_rehearsal_status=$?
fi

# Always evaluate the canonical semantic parity contract against the production restore.
# It fails closed on source-window drift, migration drift, normalized catalog mismatch,
# semantic constraint/trigger/view mismatch, or business-data/view-row mismatch.
parity_status=0
if HEROKU_APP_NAME="$HEROKU_COMPANY_APP" SOURCE_SHA="$CUTOVER_SHA" \
  VPS_DB_HOST="$VPS_DB_HOST" VPS_SSH_USER="$VPS_SSH_USER" SSH_KEY="$DB_KEY" KNOWN_HOSTS="$DB_KNOWN" \
  REPORT_FILE="$RUNNER_TEMP/final-db-reconcile.md" RUNNER_TEMP="$RUNNER_TEMP" \
  NPP958_RESTORE_DB="$PRODUCTION_DB" \
  bash npp-core/api/scripts/vps-db-heroku-parity-gate-958.sh
then
  :
else
  parity_status=$?
fi

{
  echo "GATE_C_RAW_REHEARSAL_STATUS=$raw_rehearsal_status"
  echo "GATE_C_PARITY_STATUS=$parity_status"
  if [ -s "$RUNNER_TEMP/final-db-reconcile.md" ]; then
    grep -E '^(HEROKU_BACKUP_CAPTURE|BACKUP_BYTES|SOURCE_WINDOW_STABLE|MIGRATION_WINDOW_STABLE|RESTORE_DATABASE|PG_RESTORE|RESTORED_REGISTRY_MATCH|PRE_MIGRATION_FULL_RECONCILIATION|PENDING_CORE_COUNT|PENDING_MCP_COUNT|FINAL_REGISTRY_MATCH|MIGRATION_RERUN_NOOP|POST_MIGRATION_FULL_RECONCILIATION|UNVALIDATED_FOREIGN_KEYS|UNVALIDATED_CONSTRAINTS|INVALID_INDEXES|NOT_READY_INDEXES|REHEARSAL_GATE|PARITY_POLICY|PARITY_RESTORE_DATABASE|RAW_DEPARSED_DIFF_OBJECTS|NORMALIZED_CATALOG_PARITY|CONSTRAINT_TRIGGER_VIEW_SEMANTIC_PARITY|SOURCE_INTEGRITY_STATE|PARITY_GATE)=' "$RUNNER_TEMP/final-db-reconcile.md" || true
  fi
} >> "$REPORT_FILE"

test "$parity_status" -eq 0
grep -q '^PARITY_GATE=PASS$' "$RUNNER_TEMP/final-db-reconcile.md"
grep -q '^PARITY_RESTORE_DATABASE=npp_production$' "$RUNNER_TEMP/final-db-reconcile.md"

backup_file="$(cat "$RUNNER_TEMP/final-backup-path")"
test -s "$backup_file"

# Keep a second verified copy of the final dump in R2, not only on the DB VPS/runner.
r2_enabled="$(jq -r '.R2_ENABLED // "false"' "$company_cfg")"
test "$r2_enabled" = true
for key in R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do jq -e --arg k "$key" 'has($k) and (.[$k] | tostring | length > 0)' "$company_cfg" >/dev/null; done
export R2_ENDPOINT="$(jq -r '.R2_ENDPOINT' "$company_cfg")"
export R2_BUCKET="$(jq -r '.R2_BUCKET' "$company_cfg")"
export R2_ACCESS_KEY_ID="$(jq -r '.R2_ACCESS_KEY_ID' "$company_cfg")"
export R2_SECRET_ACCESS_KEY="$(jq -r '.R2_SECRET_ACCESS_KEY' "$company_cfg")"
export R2_REGION="$(jq -r '.R2_REGION // "auto"' "$company_cfg")"
mask "$R2_ACCESS_KEY_ID"; mask "$R2_SECRET_ACCESS_KEY"
export FINAL_BACKUP_FILE="$backup_file"
export FINAL_BACKUP_KEY="backups/issue-958/${CUTOVER_SHA}-${GITHUB_RUN_ID:-manual}.dump"
node --input-type=module <<'NODE'
import { createReadStream, statSync } from 'node:fs';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
const client = new S3Client({region:process.env.R2_REGION||'auto',endpoint:process.env.R2_ENDPOINT,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}});
const size=statSync(process.env.FINAL_BACKUP_FILE).size;
await client.send(new PutObjectCommand({Bucket:process.env.R2_BUCKET,Key:process.env.FINAL_BACKUP_KEY,Body:createReadStream(process.env.FINAL_BACKUP_FILE),ContentLength:size,ContentType:'application/octet-stream'}));
const head=await client.send(new HeadObjectCommand({Bucket:process.env.R2_BUCKET,Key:process.env.FINAL_BACKUP_KEY}));
if(Number(head.ContentLength)!==size) throw new Error('final_backup_r2_size_mismatch');
console.log(`FINAL_BACKUP_R2=PASS bytes=${size}`);
NODE
unset R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY

echo 'GATE_C_FINAL_DB=PASS' >> "$REPORT_FILE"

# Resolve network identities.
db_private_ip="$(ssh_run "$DB_KEY" "$DB_KNOWN" "$VPS_DB_HOST" "ip -4 route get 1.1.1.1 | awk 'NR==1 {for(i=1;i<=NF;i++) if(\$i==\"src\") {print \$(i+1); exit}}'")"
company_private_ip="$(ssh_run "$COMPANY_KEY" "$COMPANY_KNOWN" "$VPS_COMPANY_HOST" "ip -4 route get 1.1.1.1 | awk 'NR==1 {for(i=1;i<=NF;i++) if(\$i==\"src\") {print \$(i+1); exit}}'")"
company_public_ip="$(getent ahostsv4 "$VPS_COMPANY_HOST" | awk 'NR==1{print $1}')"
mcp_public_ip="$(getent ahostsv4 "$VPS_MCP_HOST" | awk 'NR==1{print $1}')"
python3 - "$db_private_ip" "$company_private_ip" "$company_public_ip" "$mcp_public_ip" <<'PY'
import ipaddress,sys
for value in sys.argv[1:]: ipaddress.IPv4Address(value)
if ipaddress.IPv4Address(sys.argv[1]).is_private is False: raise SystemExit('db_private_ip_expected')
if ipaddress.IPv4Address(sys.argv[2]).is_private is False: raise SystemExit('company_private_ip_expected')
PY
company_api_url="https://$company_public_ip"
mcp_api_url="https://$mcp_public_ip"

# Create dedicated production runtime roles and exact HBA/firewall scope.
company_pw="$(openssl rand -hex 32)"; mcp_pw="$(openssl rand -hex 32)"
printf '%s' "$company_pw" > "$company_pw_file"; printf '%s' "$mcp_pw" > "$mcp_pw_file"
mask "$company_pw"; mask "$mcp_pw"
roles_sql="$RUNNER_TEMP/production-roles.sql"
cat > "$roles_sql" <<SQL
\\set ON_ERROR_STOP on
SELECT 'CREATE ROLE $COMPANY_DB_ROLE LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$COMPANY_DB_ROLE') \\gexec
SELECT 'CREATE ROLE $MCP_DB_ROLE LOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$MCP_DB_ROLE') \\gexec
ALTER ROLE $COMPANY_DB_ROLE LOGIN PASSWORD '$company_pw';
ALTER ROLE $MCP_DB_ROLE LOGIN PASSWORD '$mcp_pw';
GRANT CONNECT ON DATABASE $PRODUCTION_DB TO $COMPANY_DB_ROLE, $MCP_DB_ROLE;
\\connect $PRODUCTION_DB
DO \$company\$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname = ANY (ARRAY['shared','sales','purchasing','inventory','logistics','accounting','reporting']) LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO $COMPANY_DB_ROLE', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO $COMPANY_DB_ROLE', s);
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO $COMPANY_DB_ROLE', s);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO $COMPANY_DB_ROLE', s);
  END LOOP;
END \$company\$;
SELECT shared.grant_mcp_runtime_access('$MCP_DB_ROLE'::name);
ALTER ROLE $MCP_DB_ROLE SET search_path TO mcp, public;
SQL
scp_put "$DB_KEY" "$DB_KNOWN" "$VPS_DB_HOST" "$roles_sql" /tmp/npp958-production-roles.sql
ssh_run "$DB_KEY" "$DB_KNOWN" "$VPS_DB_HOST" "bash -s -- '$PRODUCTION_DB' '$COMPANY_DB_ROLE' '$MCP_DB_ROLE' '$company_private_ip' '$mcp_public_ip'" <<'REMOTE'
set -euo pipefail
db="$1"; company_role="$2"; mcp_role="$3"; company_ip="$4"; mcp_ip="$5"
sudo -n chown postgres:postgres /tmp/npp958-production-roles.sql
sudo -n chmod 600 /tmp/npp958-production-roles.sql
sudo -n -u postgres psql -v ON_ERROR_STOP=1 postgres -f /tmp/npp958-production-roles.sql >/dev/null
sudo -n rm -f /tmp/npp958-production-roles.sql
hba="$(sudo -n -u postgres psql -Atqc 'show hba_file')"; tmp="$(mktemp)"
sudo -n awk '/^# BEGIN NPP958 PRODUCTION$/{skip=1;next}/^# END NPP958 PRODUCTION$/{skip=0;next}!skip{print}' "$hba" > "$tmp"
cat >> "$tmp" <<EOF2
# BEGIN NPP958 PRODUCTION
hostssl $db $company_role ${company_ip}/32 scram-sha-256
hostssl $db $mcp_role ${mcp_ip}/32 scram-sha-256
# END NPP958 PRODUCTION
EOF2
sudo -n install -o postgres -g postgres -m 0640 "$tmp" "$hba"; rm -f "$tmp"
sudo -n ufw default deny incoming >/dev/null
sudo -n ufw default allow outgoing >/dev/null
sudo -n ufw allow 22/tcp >/dev/null
sudo -n ufw allow from "$company_ip" to any port 5432 proto tcp comment 'NPP958 company production DB' >/dev/null
sudo -n ufw allow from "$mcp_ip" to any port 5432 proto tcp comment 'NPP958 MCP production DB' >/dev/null
sudo -n ufw --force enable >/dev/null
sudo -n -u postgres psql -XAtqc 'select pg_reload_conf()' >/dev/null
test "$(sudo -n -u postgres psql -Atqc 'select count(*) from pg_hba_file_rules where error is not null')" = 0
if sudo -n ufw status | grep -Eq '^5432(/tcp)?[[:space:]]+ALLOW([[:space:]]+IN)?[[:space:]]+Anywhere'; then exit 44; fi
REMOTE
