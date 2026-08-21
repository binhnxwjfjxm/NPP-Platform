import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPgPool } from '../src/db/pool.js';
import { withAuditOutboxTransaction } from '../src/audit-outbox.js';

const config = {
  databaseUrl: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
  databaseSslMode: 'disable',
};

test('database pool absorbs idle client errors instead of leaving an unhandled error event', () => {
  class FakePool extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
    }
  }

  const messages = [];
  const originalConsoleError = console.error;
  console.error = (message) => messages.push(String(message));

  try {
    const pool = createPgPool(config, FakePool);
    const error = Object.assign(
      new Error('connection failed for postgresql://user:topsecret@database.example/npp'),
      { code: '08006' },
    );

    assert.doesNotThrow(() => pool.emit('error', error));
    assert.equal(messages.length, 1);

    const logEntry = JSON.parse(messages[0]);
    assert.equal(logEntry.event, 'database_pool_idle_client_error');
    assert.equal(logEntry.code, '08006');
    assert.equal(logEntry.message, 'connection failed for [redacted-url]');
    assert.doesNotMatch(messages[0], /topsecret/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('audit transaction absorbs checked-out client errors and destroys that connection on release', async () => {
  let releasedWith = null;
  let listenersAtRelease = null;
  const calls = [];

  class FakeClient extends EventEmitter {
    async query(sql) {
      calls.push(String(sql).trim());
      return { rows: [] };
    }

    async release(destroy) {
      listenersAtRelease = this.listenerCount('error');
      releasedWith = destroy;
    }
  }

  const client = new FakeClient();
  const adapter = { connect: async () => client };
  const messages = [];
  const originalConsoleError = console.error;
  console.error = (message) => messages.push(String(message));

  try {
    const result = await withAuditOutboxTransaction({
      adapter,
      mutate: async () => {
        const error = Object.assign(
          new Error('connection reset for postgresql://user:topsecret@database.example/npp'),
          { code: 'ECONNRESET' },
        );
        assert.doesNotThrow(() => client.emit('error', error));
        return { replayed: true };
      },
    });

    assert.equal(result.replayed, true);
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(calls, ['BEGIN', 'COMMIT']);
  assert.equal(releasedWith, true);
  assert.equal(listenersAtRelease, 0);
  assert.equal(client.listenerCount('error'), 0);
  assert.equal(messages.length, 1);

  const logEntry = JSON.parse(messages[0]);
  assert.equal(logEntry.event, 'database_checked_out_client_error');
  assert.equal(logEntry.code, 'ECONNRESET');
  assert.equal(logEntry.message, 'connection reset for [redacted-url]');
  assert.doesNotMatch(messages[0], /topsecret/);
});

test('audit transaction destroys a checked-out client when rollback cannot recover the connection', async () => {
  let releasedWith = null;
  const calls = [];
  const client = {
    async query(sql) {
      const statement = String(sql).trim();
      calls.push(statement);
      if (statement === 'ROLLBACK') {
        throw Object.assign(new Error('connection terminated'), { code: '08006' });
      }
      return { rows: [] };
    },
    async release(destroy) {
      releasedWith = destroy;
    },
  };
  const adapter = { connect: async () => client };

  const messages = [];
  const originalConsoleError = console.error;
  console.error = (message) => messages.push(String(message));

  try {
    await assert.rejects(
      withAuditOutboxTransaction({
        adapter,
        mutate: async () => {
          throw new Error('mutation failed');
        },
      }),
      /mutation failed/,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK']);
  assert.equal(releasedWith, true);
  assert.equal(messages.length, 1);
  assert.equal(JSON.parse(messages[0]).event, 'audit_outbox_transaction_failed');
});
