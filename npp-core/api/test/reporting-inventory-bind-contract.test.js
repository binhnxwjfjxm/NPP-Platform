import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exactReportingQueryValues,
  reportingInventoryBindingInternals,
} from '../src/routes/reporting-inventory-safe.js';

test('inventory reporting trims only unused PostgreSQL bind values', () => {
  assert.deepEqual(exactReportingQueryValues('SELECT $1::text, $3::text', ['a', 'b', 'c', 'unused']), ['a', 'b', 'c']);
  assert.deepEqual(exactReportingQueryValues('SELECT 1', ['unused']), []);
  assert.throws(
    () => exactReportingQueryValues('SELECT $1, $4', ['a', 'b', 'c']),
    (error) => error?.code === 'REPORTING_QUERY_BINDING_MISSING',
  );
});

test('inventory reporting adapter never sends more values than the SQL references', async () => {
  const calls = [];
  const adapter = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  const wrapped = reportingInventoryBindingInternals.exactBindingAdapter(adapter);
  await wrapped.query('SELECT $1, $2, $5', ['a', 'b', 'c', 'd', 'e', 'extra', 'extra2']);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, ['a', 'b', 'c', 'd', 'e']);
});
