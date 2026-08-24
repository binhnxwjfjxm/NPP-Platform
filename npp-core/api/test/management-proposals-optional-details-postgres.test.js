import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';

test('PostgreSQL proposal accepts title/content-only business input after migration 110', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    INSTALLATION_ID: `proposal-optional-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3005',
  });
  const pool = getPool(config);
  const client = await pool.connect();
  const id = `proposal_test_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO shared.management_proposals (
        id, installation_id, source, domain, title, content, entity_type,
        requester_actor_id, requester_name
      ) VALUES ($1,$2,'company','commercial',$3,$4,'other',$5,$6)
      RETURNING entity_id, entity_label, impact, reason, rule_text, evidence, priority, status`,
      [id, config.installationId, 'Đề xuất thử', 'Chỉ có nội dung cần quyết định', 'test:actor', 'Nhân viên thử'],
    );
    assert.deepEqual(inserted.rows[0], {
      entity_id: '',
      entity_label: '',
      impact: '',
      reason: '',
      rule_text: '',
      evidence: [],
      priority: 'normal',
      status: 'pending',
    });
    await client.query('ROLLBACK');
  } finally {
    client.release();
    await closePool();
  }
});
