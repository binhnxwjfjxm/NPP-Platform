import test from 'node:test';
import assert from 'node:assert/strict';
import { runSalesQueryWithBudget } from '../src/routes/reporting-sales.js';

test('Sales report queries share a four-connection global budget', async () => {
  let active = 0;
  let peak = 0;
  const adapter = {
    query: async (_query, value) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active--;
      return { rows: [value] };
    },
  };
  const responses = await Promise.all(Array.from({ length: 24 }, (_unused, i) =>
    runSalesQueryWithBudget(adapter, i + 1, 'SELECT 1', [i])));
  assert.equal(responses.length, 24);
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.deepEqual(responses.map((r) => r.rows[0][0]), Array.from({ length: 24 }, (_unused, i) => i));
});

test('An unsuccessful report query releases its budget slot and allows other requests', async () => {
  let attempts = 0;
  const adapter = {
    query: async () => {
      attempts++;
      if (attempts === 1) throw new Error('expected_fake_database_failure');
      return { rows: ['ok'] };
    },
  };
  await assert.rejects(runSalesQueryWithBudget(adapter, 1, 'SELECT 1', []), /expected_fake_database_failure/);
  assert.deepEqual(await runSalesQueryWithBudget(adapter, 2, 'SELECT 1', []), { rows: ['ok'] });
});
