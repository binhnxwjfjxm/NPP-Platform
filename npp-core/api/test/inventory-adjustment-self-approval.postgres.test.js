import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3081',
    INSTALLATION_ID: 'inventory-adjustment-self-approval-schema-test',
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

test('database no longer blocks governed Owner self-approval with the obsolete creator/approver constraint', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const result = await pool.query(`
      SELECT constraint_name
        FROM information_schema.table_constraints
       WHERE table_schema = 'inventory'
         AND table_name = 'inventory_adjustments'
         AND constraint_name = 'inventory_adjustments_creator_approver_separation_ck'
    `);
    assert.equal(result.rowCount, 0);
  } finally {
    await closePool();
  }
});
