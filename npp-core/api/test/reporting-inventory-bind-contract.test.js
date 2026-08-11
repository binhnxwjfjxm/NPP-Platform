import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactReportingQueryBindings,
  exactReportingQueryValues,
  reportingInventoryBindingInternals,
} from '../src/routes/reporting-inventory-safe.js';

test('inventory reporting compacts sparse PostgreSQL bind values', () => {
  assert.deepEqual(exactReportingQueryValues('SELECT $1::text, $3::text', ['a', 'unused', 'c', 'extra']), ['a', 'c']);
  assert.deepEqual(exactReportingQueryValues('SELECT 1', ['unused']), []);
  assert.deepEqual(
    compactReportingQueryBindings('SELECT $1::text, $2::uuid[], $5::uuid, $6::date, $7::int, $5::uuid', ['installation', ['warehouse'], 'from', 'to', 'warehouse-id', '2026-08-11', 90]),
    {
      sql: 'SELECT $1::text, $2::uuid[], $3::uuid, $4::date, $5::int, $3::uuid',
      values: ['installation', ['warehouse'], 'warehouse-id', '2026-08-11', 90],
    },
  );
  assert.throws(
    () => exactReportingQueryValues('SELECT $1, $4', ['a', 'b', 'c']),
    (error) => error?.code === 'REPORTING_QUERY_BINDING_MISSING',
  );
});

test('inventory reporting adapter renumbers sparse placeholders before PostgreSQL sees them', async () => {
  const calls = [];
  const adapter = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  const wrapped = reportingInventoryBindingInternals.exactBindingAdapter(adapter);
  await wrapped.query('SELECT $1, $2, $5, $2, $7', ['a', 'b', 'unused-c', 'unused-d', 'e', 'unused-f', 'g']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, 'SELECT $1, $2, $3, $2, $4');
  assert.deepEqual(calls[0].values, ['a', 'b', 'e', 'g']);
});
