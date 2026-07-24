import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockRequest, createMockPool } from '../index.js';

test('creates a mock request', () => {
  const request = createMockRequest({ method: 'POST', url: '/api/config' });
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/api/config');
});

test('creates a mock pool', async () => {
  const pool = createMockPool(async () => ({ rows: [{ ok: true }] }));
  const result = await pool.query('SELECT 1');
  assert.deepEqual(result.rows, [{ ok: true }]);
});
