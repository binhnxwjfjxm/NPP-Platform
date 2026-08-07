import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { PERMISSIONS, PERMISSION_CATALOG } from '../src/access/permissions.js';

const migrationSql = readFileSync(
  new URL('../../../database/migrations/shared/065_reporting_inventory_permission_catalog.sql', import.meta.url),
  'utf8',
);

function catalog(permissionKey) {
  return PERMISSION_CATALOG.find((entry) => entry.permissionKey === permissionKey);
}

function migrationPermissionRow(sql) {
  const match = /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(true|false)\s*,\s*now\(\)\s*\)/u.exec(sql);
  if (!match) return null;
  return Object.freeze({
    permissionKey: match[1],
    module: match[2],
    label: match[3],
    description: match[4],
    isSystem: match[5] === 'true',
  });
}

test('8.2 permission migration follows 064 and is registered with exact SQL', () => {
  const previous = CORE_API_MIGRATIONS.at(-2);
  const last = CORE_API_MIGRATIONS.at(-1);
  assert.equal(previous?.id, '064_reporting_permission_catalog');
  assert.equal(last?.id, '065_reporting_inventory_permission_catalog');
  assert.equal(last?.sql, migrationSql);
});

test('8.2 migration metadata exactly matches runtime inventory reporting permission', () => {
  const entry = catalog(PERMISSIONS.coreReportingInventoryRead);
  assert.ok(entry);
  assert.deepEqual(migrationPermissionRow(migrationSql), {
    permissionKey: entry.permissionKey,
    module: entry.module,
    label: entry.label,
    description: entry.description,
    isSystem: entry.isSystem,
  });
});

test('8.2 permission migration is rerunnable metadata only and never assigns roles', () => {
  assert.match(migrationSql, /ON CONFLICT \(permission_key\) DO UPDATE/);
  assert.doesNotMatch(migrationSql, /INSERT\s+INTO\s+shared\.role_permissions/i);
  assert.doesNotMatch(migrationSql, /UPDATE\s+shared\.role_permissions/i);
  assert.doesNotMatch(migrationSql, /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
});
