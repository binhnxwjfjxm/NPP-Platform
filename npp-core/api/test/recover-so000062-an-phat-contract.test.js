import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const recoverySource = await readFile(
  new URL('../scripts/recover-so000062-an-phat.mjs', import.meta.url),
  'utf8',
);

test('SO000062 recovery keeps native PostgreSQL types while cloning v6', () => {
  assert.match(recoverySource, /async function cloneDatabaseRow/);
  assert.match(recoverySource, /source\.\$\{quotedIdentifier\(column\)\}/);
  assert.match(recoverySource, /INSERT INTO \$\{quotedIdentifier\(schema\)\}\.\$\{quotedIdentifier\(table\)\}/);
  assert.match(recoverySource, /SELECT \$\{selectExpressions\.join\(', '\)\}/);
  assert.doesNotMatch(recoverySource, /SELECT \*/);
  assert.doesNotMatch(recoverySource, /valuesByColumn/);
  assert.doesNotMatch(recoverySource, /insertObject/);
});

test('SO000062 recovery is exact-target, fail-closed and transaction guarded', () => {
  assert.match(recoverySource, /orderNumber: 'SO-202609-000062'/);
  assert.match(recoverySource, /sourceVersion: 6/);
  assert.match(recoverySource, /wrongVersion: 7/);
  assert.match(recoverySource, /nextVersion: 8/);
  assert.match(recoverySource, /sourceLineSignature: '779c67a77a16e91ef0267e6f59b94693'/);
  assert.match(recoverySource, /wrongLineSignature: 'c04565855b27cd1c2faf9a9e417b5326'/);
  assert.match(recoverySource, /createIdempotencyKey\('sales-order-recovery', TARGET\.orderId\)/);
  assert.match(recoverySource, /releasePreExecutionAllocations/);
  assert.match(recoverySource, /replaceSalesOrderFulfillmentDemand/);
  assert.match(recoverySource, /client\.query\('ROLLBACK'\)/);
  assert.match(recoverySource, /final_customer_not_an_phat/);
  assert.match(recoverySource, /final_total_not_restored/);
  assert.match(recoverySource, /wrong_version_history_changed/);
  assert.doesNotMatch(recoverySource, /comparisonOrderId|comparison_order_/);
});
