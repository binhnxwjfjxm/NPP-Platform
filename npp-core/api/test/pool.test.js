import test from 'node:test';
import assert from 'node:assert/strict';
import { createPgPool, closePool } from '../src/db/pool.js';

test('createPgPool returns a pool object without connecting immediately', () => {
  const pool = createPgPool({
    databaseUrl: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    databaseSslMode: 'disable',
  });

  assert.ok(pool);
  assert.equal(typeof pool.query, 'function');
  assert.equal(typeof pool.end, 'function');
});

test('closePool disposes the pool safely', async () => {
  const pool = createPgPool({
    databaseUrl: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    databaseSslMode: 'disable',
  });

  await closePool();
  assert.ok(pool);
});
