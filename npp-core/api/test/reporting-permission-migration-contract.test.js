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

test('8.1 reporting permission metadata is forward-migrated after 063', () => {
  const last = CORE_API_MIGRATIONS.at(-1);
  assert.equal(last?.id, '064_reporting_permission_catalog');
  assert.match(last?.sql ?? '', /core\.reporting\.sales\.read/);
  assert.match(last?.sql ?? '', /core\.reporting\.purchasing\.read/);
});

test('8.1 migration metadata exactly matches the runtime permission catalog', () => {
  const sales = catalog(PERMISSIONS.coreReportingSalesRead);
  const purchasing = catalog(PERMISSIONS.coreReportingPurchasingRead);
  assert.ok(sales);
  assert.ok(purchasing);

  for (const entry of [sales, purchasing]) {
    assert.match(migrationSql, new RegExp(entry.permissionKey.replaceAll('.', '\\.'), 'u'));
    assert.ok(migrationSql.includes(`'${entry.module}'`));
    assert.ok(migrationSql.includes(`'${entry.label}'`));
    assert.ok(migrationSql.includes(`'${entry.description}'`));
  }
});

test('8.1 permission migration is rerunnable metadata only and never assigns a role', () => {
  assert.match(migrationSql, /ON CONFLICT \(permission_key\) DO UPDATE/);
  assert.doesNotMatch(migrationSql, /INSERT\s+INTO\s+shared\.role_permissions/i);
  assert.doesNotMatch(migrationSql, /UPDATE\s+shared\.role_permissions/i);
  assert.doesNotMatch(migrationSql, /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
});
