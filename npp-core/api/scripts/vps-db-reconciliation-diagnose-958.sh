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
export REPORT_FILE="$RUNNER_TEMP/vps-db-reconciliation-diagnose-base.tmp"
export REQUESTED_ACTION=rehearse
export SOURCE_SHA="${SOURCE_SHA:-diagnostic}"

# Reuse the canonical snapshot/query helpers without executing the rehearsal entrypoint.
# The exact invocation line appears after all function definitions.
# shellcheck disable=SC1090
source <(awk '/^resolve_heroku_database$/ {exit} {print}' "$main_script")
export REPORT_FILE="$original_report"

resolve_heroku_database
write_snapshot_sql

source_snapshot="$RUNNER_TEMP/diagnose-source.snapshot"
restored_snapshot="$RUNNER_TEMP/diagnose-restored.snapshot"
snapshot_source "$source_snapshot"

if ! snapshot_remote "$restored_snapshot"; then
  {
    echo
    echo '```text'
    echo 'RECONCILIATION_DIAGNOSTIC=restored_snapshot_unavailable'
    echo '```'
  } >> "$original_report"
  exit 0
fi

SOURCE_SNAPSHOT="$source_snapshot" RESTORED_SNAPSHOT="$restored_snapshot" DIAG_REPORT="$RUNNER_TEMP/reconciliation-diff.txt" node --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';

const sourceLines = readFileSync(process.env.SOURCE_SNAPSHOT, 'utf8').trim().split(/\r?\n/).filter(Boolean);
const restoredLines = readFileSync(process.env.RESTORED_SNAPSHOT, 'utf8').trim().split(/\r?\n/).filter(Boolean);

function keyFor(line) {
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

const source = new Map(sourceLines.map((line) => [keyFor(line), line]));
const restored = new Map(restoredLines.map((line) => [keyFor(line), line]));
const allKeys = [...new Set([...source.keys(), ...restored.keys()])].sort();
const diffKeys = allKeys.filter((key) => source.get(key) !== restored.get(key));
const categories = new Map();
for (const key of diffKeys) {
  const category = key.split('|')[0];
  categories.set(category, (categories.get(category) || 0) + 1);
}

function invalidConstraints(lines) {
  return lines
    .filter((line) => line.startsWith('constraint|'))
    .map((line) => line.split('|'))
    .filter((p) => p[4] === 'false')
    .map((p) => `${p[1]}.${p[2]}:${p[3]}`)
    .sort();
}

const sourceInvalid = invalidConstraints(sourceLines);
const restoredInvalid = invalidConstraints(restoredLines);

const safeDetail = [];
for (const key of diffKeys) {
  const s = source.get(key);
  const r = restored.get(key);
  if (key.startsWith('database') || key.startsWith('extension|') || key.startsWith('integrity|') || key.startsWith('schema_count|')) {
    safeDetail.push(`DIFF_DETAIL=${key}|SOURCE=${s || 'missing'}|RESTORED=${r || 'missing'}`);
  } else if (key.startsWith('table|')) {
    const sp = (s || '').split('|');
    const rp = (r || '').split('|');
    safeDetail.push(`DIFF_DETAIL=${key}|SOURCE_ROWS=${sp[2] || 'missing'}|RESTORED_ROWS=${rp[2] || 'missing'}`);
  } else {
    safeDetail.push(`DIFF_KEY=${key}`);
  }
}

const out = [
  'RECONCILIATION_DIAGNOSTIC=PASS',
  `DIFF_KEY_COUNT=${diffKeys.length}`,
  ...[...categories.entries()].sort().map(([category, count]) => `DIFF_CATEGORY_${category.toUpperCase()}=${count}`),
  `SOURCE_UNVALIDATED_CONSTRAINTS=${sourceInvalid.join(',') || 'none'}`,
  `RESTORED_UNVALIDATED_CONSTRAINTS=${restoredInvalid.join(',') || 'none'}`,
  ...safeDetail,
];
writeFileSync(process.env.DIAG_REPORT, out.join('\n') + '\n');
NODE

{
  echo
  echo '```text'
  cat "$RUNNER_TEMP/reconciliation-diff.txt"
  echo '```'
} >> "$original_report"
