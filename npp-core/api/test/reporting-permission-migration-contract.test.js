import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { PERMISSIONS, PERMISSION_CATALOG } from '../src/access/permissions.js';

const migrationSql = readFileSync(
  new URL('../../../database/migrations/shared/064_reporting_permission_catalog.sql', import.meta.url),
  'utf8',
);

function catalog(permissionKey) {
  return PERMISSION_CATALOG.find((entry) => entry.permissionKey === permissionKey);
}

function migrationPermissionRows(sql) {
  const rowPattern = /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(true|false)\s*,\s*now\(\)\s*\)/gu;
  return new Map([...sql.matchAll(rowPattern)].map((match) => [
    match[1],
    Object.freeze({
      permissionKey: match[1],
      module: match[2],
      label: match[3],
      description: match[4],
      isSystem: match[5] === 'true',
    }),
  ]));
}

test('8.1 reporting permission metadata follows 063 even when later migrations exist', () => {
  const index = CORE_API_MIGRATIONS.findIndex((migration) => migration.id === '064_reporting_permission_catalog');
  assert.ok(index > 0);
  assert.equal(CORE_API_MIGRATIONS[index - 1]?.id, '063_inventory_costing_periods_backdate');
  assert.equal(CORE_API_MIGRATIONS[index]?.sql, migrationSql);
});

test('8.1 migration rows exactly match the runtime permission catalog metadata', () => {
  const sales = catalog(PERMISSIONS.coreReportingSalesRead);
  const purchasing = catalog(PERMISSIONS.coreReportingPurchasingRead);
  assert.ok(sales);
  assert.ok(purchasing);

  const rows = migrationPermissionRows(migrationSql);
  assert.equal(rows.size, 2);

  for (const entry of [sales, purchasing]) {
    assert.deepEqual(rows.get(entry.permissionKey), {
      permissionKey: entry.permissionKey,
      module: entry.module,
      label: entry.label,
      description: entry.description,
      isSystem: entry.isSystem,
    });
  }
});

test('8.1 permission migration is rerunnable metadata only and never assigns a role', () => {
  assert.match(migrationSql, /ON CONFLICT \(permission_key\) DO UPDATE/);
  assert.doesNotMatch(migrationSql, /INSERT\s+INTO\s+shared\.role_permissions/i);
  assert.doesNotMatch(migrationSql, /UPDATE\s+shared\.role_permissions/i);
  assert.doesNotMatch(migrationSql, /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
});
