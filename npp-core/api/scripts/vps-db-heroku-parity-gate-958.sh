#!/usr/bin/env bash
set -euo pipefail

: "${HEROKU_API_KEY:?HEROKU_API_KEY is required}"
: "${HEROKU_APP_NAME:?HEROKU_APP_NAME is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${REPORT_FILE:?REPORT_FILE is required}"
: "${VPS_DB_HOST:?VPS_DB_HOST is required}"
: "${VPS_SSH_USER:?VPS_SSH_USER is required}"
: "${SSH_KEY:?SSH_KEY is required}"
: "${KNOWN_HOSTS:?KNOWN_HOSTS is required}"

main_script="npp-core/api/scripts/vps-db-heroku-rehearsal-958.sh"
original_report="$REPORT_FILE"
export REQUESTED_ACTION=rehearse
export SOURCE_SHA="${SOURCE_SHA:-parity}"

# Reuse canonical connection helpers without executing the rehearsal entrypoint.
# shellcheck disable=SC1090
source <(awk '/^resolve_heroku_database$/ {exit} {print}' "$main_script")
export REPORT_FILE="$original_report"

source_before="$RUNNER_TEMP/source-before.snapshot"
source_after="$RUNNER_TEMP/source-after.snapshot"
restored_after="$RUNNER_TEMP/restored-after-migrate.snapshot"
migration_before="$RUNNER_TEMP/heroku-migration-ids.tsv"
migration_after="$RUNNER_TEMP/heroku-migration-ids-after.tsv"

for required in "$source_before" "$source_after" "$restored_after" "$migration_before" "$migration_after"; do
  test -s "$required"
done

# Preserve the source as-is: the source state must be stable while the backup is captured.
cmp -s "$source_before" "$source_after"
cmp -s "$migration_before" "$migration_after"

normalized_source="$RUNNER_TEMP/parity-source-normalized.snapshot"
normalized_restored="$RUNNER_TEMP/parity-restored-normalized.snapshot"

normalize_snapshot() {
  awk -F'|' 'BEGIN { OFS="|" }
    $1=="constraint" { print $1,$2,$3,$4,$5; next }
    $1=="trigger" { print $1,$2,$3; next }
    $1=="view" { print $1,$2,$3; next }
    { print }
  ' "$1" | LC_ALL=C sort -u
}

normalize_snapshot "$source_after" > "$normalized_source"
normalize_snapshot "$restored_after" > "$normalized_restored"
cmp -s "$normalized_source" "$normalized_restored"

# pg_get_constraintdef/pg_get_triggerdef/pg_get_viewdef are version-sensitive deparsers.
# Compare those objects through stable catalog semantics instead of byte-identical text.
semantic_sql="$RUNNER_TEMP/parity-semantic.sql"
cat > "$semantic_sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL TIME ZONE 'UTC';

SELECT line
FROM (
  SELECT
    'constraint_semantic|' || quote_ident(n.nspname) || '.' || quote_ident(t.relname) || '|' || quote_ident(c.conname) || '|' ||
    c.contype::text || '|' || c.convalidated::text || '|' || c.condeferrable::text || '|' || c.condeferred::text || '|' ||
    c.confupdtype::text || '|' || c.confdeltype::text || '|' || c.confmatchtype::text || '|' ||
    coalesce(quote_ident(rn.nspname) || '.' || quote_ident(rt.relname), 'none') || '|' ||
    coalesce((
      SELECT string_agg(quote_ident(a.attname), ',' ORDER BY k.ord)
      FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    ), 'none') || '|' ||
    coalesce((
      SELECT string_agg(quote_ident(a.attname), ',' ORDER BY k.ord)
      FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
    ), 'none') AS line
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  LEFT JOIN pg_class rt ON rt.oid = c.confrelid
  LEFT JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE n.nspname = ANY (ARRAY['public','shared','mcp','sales','purchasing','inventory','logistics','accounting','reporting'])
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dep
      WHERE dep.classid = 'pg_class'::regclass AND dep.objid = t.oid AND dep.deptype = 'e'
    )

  UNION ALL

  SELECT
    'trigger_semantic|' || quote_ident(n.nspname) || '.' || quote_ident(t.relname) || '|' || quote_ident(g.tgname) || '|' ||
    g.tgenabled::text || '|' || g.tgtype::text || '|' || g.tgdeferrable::text || '|' || g.tginitdeferred::text || '|' ||
    quote_ident(fn.nspname) || '.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
    encode(g.tgargs, 'hex') || '|' || (g.tgqual IS NULL)::text AS line
  FROM pg_trigger g
  JOIN pg_class t ON t.oid = g.tgrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_proc p ON p.oid = g.tgfoid
  JOIN pg_namespace fn ON fn.oid = p.pronamespace
  WHERE n.nspname = ANY (ARRAY['public','shared','mcp','sales','purchasing','inventory','logistics','accounting','reporting'])
    AND NOT g.tgisinternal
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dep
      WHERE dep.classid = 'pg_class'::regclass AND dep.objid = t.oid AND dep.deptype = 'e'
    )

  UNION ALL

  SELECT DISTINCT
    'view_dependency|' || quote_ident(vn.nspname) || '.' || quote_ident(v.relname) || '|' ||
    quote_ident(rn.nspname) || '.' || quote_ident(r.relname) AS line
  FROM pg_class v
  JOIN pg_namespace vn ON vn.oid = v.relnamespace
  JOIN pg_rewrite rw ON rw.ev_class = v.oid
  JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid AND d.refclassid = 'pg_class'::regclass
  JOIN pg_class r ON r.oid = d.refobjid
  JOIN pg_namespace rn ON rn.oid = r.relnamespace
  WHERE vn.nspname = ANY (ARRAY['public','shared','mcp','sales','purchasing','inventory','logistics','accounting','reporting'])
    AND v.relkind IN ('v','m')
    AND r.oid <> v.oid
) AS semantic_lines
ORDER BY line;

CREATE TEMP TABLE parity_view_fingerprints (
  relation_name text PRIMARY KEY,
  row_count bigint NOT NULL,
  hash_sum_a numeric NOT NULL,
  hash_sum_b numeric NOT NULL,
  hash_min text NOT NULL,
  hash_max text NOT NULL
) ON COMMIT DROP;

DO $views$
DECLARE
  relation record;
  row_count bigint;
  hash_sum_a numeric;
  hash_sum_b numeric;
  hash_min text;
  hash_max text;
BEGIN
  FOR relation IN
    SELECT n.nspname AS schema_name, c.relname AS relation_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY (ARRAY['public','shared','mcp','sales','purchasing','inventory','logistics','accounting','reporting'])
      AND c.relkind = 'v'
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format(
      $sql$
      WITH row_hashes AS (
        SELECT md5(to_jsonb(t)::text) AS row_hash
        FROM %I.%I AS t
      )
      SELECT count(*)::bigint,
             coalesce(sum((('x' || substr(row_hash, 1, 15))::bit(60)::bigint)::numeric), 0),
             coalesce(sum((('x' || substr(row_hash, 17, 15))::bit(60)::bigint)::numeric), 0),
             coalesce(min(row_hash), 'none'),
             coalesce(max(row_hash), 'none')
      FROM row_hashes
      $sql$,
      relation.schema_name,
      relation.relation_name
    ) INTO row_count, hash_sum_a, hash_sum_b, hash_min, hash_max;

    INSERT INTO pg_temp.parity_view_fingerprints
    VALUES (format('%s.%s', relation.schema_name, relation.relation_name), row_count, hash_sum_a, hash_sum_b, hash_min, hash_max);
  END LOOP;
END
$views$;

SELECT 'view_rows|' || relation_name || '|' || row_count::text || '|' || hash_sum_a::text || '|' ||
       hash_sum_b::text || '|' || hash_min || '|' || hash_max
FROM pg_temp.parity_view_fingerprints
ORDER BY relation_name;
COMMIT;
SQL

resolve_heroku_database
semantic_source="$RUNNER_TEMP/parity-source-semantic.snapshot"
semantic_restored="$RUNNER_TEMP/parity-restored-semantic.snapshot"
heroku_psql -f "$semantic_sql" > "$semantic_source"
ssh_base "sudo -n -u postgres psql -XqAt -v ON_ERROR_STOP=1 -d '$restore_db'" < "$semantic_sql" > "$semantic_restored"
test -s "$semantic_source"
test -s "$semantic_restored"
cmp -s "$semantic_source" "$semantic_restored"

raw_diff_file="$RUNNER_TEMP/parity-raw-diff-count.txt"
SOURCE_SNAPSHOT="$source_after" RESTORED_SNAPSHOT="$restored_after" OUT_FILE="$raw_diff_file" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const read = (path) => readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean);
function key(line) {
  const p = line.split('|');
  switch (p[0]) {
    case 'table': return `table|${p[1]}`;
    case 'sequence': return `sequence|${p[1]}`;
    case 'namespace': return `namespace|${p[1]}`;
    case 'schema_count': return `schema_count|${p[1]}|${p[2]}`;
    case 'column': return `column|${p[1]}|${p[2]}`;
    case 'constraint': return `constraint|${p[1]}|${p[2]}`;
    case 'index': return `index|${p[1]}|${p[2]}`;
    case 'view': return `view|${p[1]}`;
    case 'table_security': return `table_security|${p[1]}`;
    case 'routine': return `routine|${p[1]}`;
    case 'trigger': return `trigger|${p[1]}|${p[2]}`;
    case 'policy': return `policy|${p[1]}|${p[2]}`;
    case 'enum': return `enum|${p[1]}|${p[2]}`;
    case 'extension': return `extension|${p[1]}`;
    case 'database': return 'database';
    case 'integrity': return `integrity|${p[1]}`;
    default: return line;
  }
}
const s = new Map(read(process.env.SOURCE_SNAPSHOT).map((line) => [key(line), line]));
const r = new Map(read(process.env.RESTORED_SNAPSHOT).map((line) => [key(line), line]));
const keys = new Set([...s.keys(), ...r.keys()]);
const diffs = [...keys].filter((k) => s.get(k) !== r.get(k));
writeFileSync(process.env.OUT_FILE, String(diffs.length) + '\n');
NODE

raw_diff_count="$(cat "$raw_diff_file")"
{
  echo
  echo '```text'
  echo 'PARITY_POLICY=preserve_source_state'
  echo 'SOURCE_WINDOW_STABLE=yes'
  echo 'MIGRATION_WINDOW_STABLE=yes'
  echo "RAW_DEPARSED_DIFF_OBJECTS=$raw_diff_count"
  echo 'NORMALIZED_CATALOG_PARITY=PASS'
  echo 'CONSTRAINT_TRIGGER_VIEW_SEMANTIC_PARITY=PASS'
  echo 'SOURCE_INTEGRITY_STATE=PRESERVED'
  echo 'PRODUCTION_TRAFFIC=not_enabled'
  echo 'CUTOVER=not_performed'
  echo 'PARITY_GATE=PASS'
  echo '```'
} >> "$original_report"
