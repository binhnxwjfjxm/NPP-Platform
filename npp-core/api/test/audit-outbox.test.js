import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';
import { createRequestContext, PERMISSIONS } from '../src/request-context.js';
import { buildAuditRecord, buildOutboxEvent, withAuditOutboxTransaction } from '../src/audit-outbox.js';

const token = '0123456789abcdef0123456789abcdef';
let server;

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3107',
    INSTALLATION_ID: 'npp-hung-phat',
    DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: token,
    CORE_BOOTSTRAP_ACTOR_ID: 'bootstrap:core-api',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

function testConfig(overrides = {}) {
  return loadConfig(testEnv(overrides));
}

function authorizedHeaders() {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function closeServer(target) {
  return new Promise((resolve, reject) => target.close((error) => (error ? reject(error) : resolve())));
}

function createFakeClient({ failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      const text = String(sql).trim();
      calls.push({ sql: text, values });
      if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
        return { rows: [] };
      }

      if (failOn && failOn(text, values)) {
        throw new Error('simulated database failure');
      }

      return { rows: [], rowCount: 1 };
    },
    async release() {},
  };
}

function createFakeAdapter(client) {
  return { connect: async () => client };
}

test.before(async () => {
  server = await startServer({
    config: testConfig(),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
    auditOutboxAdapter: createFakeAdapter(createFakeClient()),
  });
});

test.after(async () => {
  if (server) await closeServer(server);
});

test('buildAuditRecord and buildOutboxEvent derive server-owned context and redact secrets', () => {
  const requestContext = createRequestContext({
    config: testConfig(),
    principal: {
      actorId: 'bootstrap:core-api',
      permissions: [PERMISSIONS.coreAuditOutboxTestWrite],
      roles: ['bootstrap'],
      sourceApp: 'npp-core-api',
    },
  });

  const auditRecord = buildAuditRecord({
    requestContext,
    action: 'test.action',
    resourceType: 'test.resource',
    afterData: { value: 'ok', password: 'secret' },
    metadata: { apiKey: 'secret-key', note: 'safe' },
  });

  assert.equal(auditRecord.actorId, 'bootstrap:core-api');
  assert.equal(auditRecord.installationId, 'npp-hung-phat');
  assert.equal(auditRecord.sourceApp, 'npp-core-api');
  assert.equal(auditRecord.afterData.password, null);
  assert.equal(auditRecord.metadata.apiKey, null);

  const outboxEvent = buildOutboxEvent({
    requestContext,
    aggregateType: 'test.aggregate',
    aggregateId: 'agg-1',
    eventType: 'test.created',
    eventVersion: 1,
    payload: { user: 'ok', secret: 'value' },
    metadata: { token: 'token-value' },
  });

  assert.equal(outboxEvent.actorId, 'bootstrap:core-api');
  assert.equal(outboxEvent.payload.secret, null);
  assert.equal(outboxEvent.metadata.token, null);
});

test('withAuditOutboxTransaction commits when mutation succeeds', async () => {
  const client = createFakeClient();
  const adapter = createFakeAdapter(client);
  const requestContext = createRequestContext({
    config: testConfig(),
    principal: {
      actorId: 'bootstrap:core-api',
      permissions: [PERMISSIONS.coreAuditOutboxTestWrite],
      roles: ['bootstrap'],
      sourceApp: 'npp-core-api',
    },
  });

  const result = await withAuditOutboxTransaction({
    adapter,
    mutate: async (client, { buildAuditRecord, buildOutboxEvent, insertAuditRecord, insertOutboxEvent }) => {
      const auditRecord = buildAuditRecord({
        requestContext,
        action: 'test.commit',
        resourceType: 'test',
        afterData: { value: 'ok' },
      });
      const outboxEvent = buildOutboxEvent({
        requestContext,
        aggregateType: 'test',
        aggregateId: 'id-1',
        eventType: 'test.committed',
        eventVersion: 1,
        payload: { value: 'ok' },
      });

      await insertAuditRecord(client, auditRecord);
      await insertOutboxEvent(client, outboxEvent);
      return { auditId: auditRecord.auditId, eventId: outboxEvent.eventId };
    },
  });

  assert.ok(result.auditId);
  assert.ok(result.eventId);
  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
  assert.ok(client.calls.some((call) => call.sql.startsWith('INSERT INTO shared.core_audit_records')));
  assert.ok(client.calls.some((call) => call.sql.startsWith('INSERT INTO shared.core_outbox_events')));
});

test('withAuditOutboxTransaction rolls back when mutation throws', async () => {
  const client = createFakeClient();
  const adapter = createFakeAdapter(client);

  await assert.rejects(
    withAuditOutboxTransaction({
      adapter,
      mutate: async () => {
        throw new Error('boom');
      },
    }),
    /boom/,
  );

  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('withAuditOutboxTransaction rolls back when audit insert fails', async () => {
  const client = createFakeClient({
    failOn: (sql) => sql.startsWith('INSERT INTO shared.core_audit_records'),
  });
  const adapter = createFakeAdapter(client);
  const requestContext = createRequestContext({
    config: testConfig(),
    principal: {
      actorId: 'bootstrap:core-api',
      permissions: [PERMISSIONS.coreAuditOutboxTestWrite],
      roles: ['bootstrap'],
      sourceApp: 'npp-core-api',
    },
  });

  await assert.rejects(
    withAuditOutboxTransaction({
      adapter,
      mutate: async (client, { buildAuditRecord, insertAuditRecord }) => {
        const auditRecord = buildAuditRecord({
          requestContext,
          action: 'test.fail',
          resourceType: 'test',
          afterData: { value: 'ok' },
        });
        await insertAuditRecord(client, auditRecord);
      },
    }),
    /simulated database failure/,
  );

  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('withAuditOutboxTransaction rolls back when outbox insert fails', async () => {
  const client = createFakeClient({
    failOn: (sql) => sql.startsWith('INSERT INTO shared.core_outbox_events'),
  });
  const adapter = createFakeAdapter(client);
  const requestContext = createRequestContext({
    config: testConfig(),
    principal: {
      actorId: 'bootstrap:core-api',
      permissions: [PERMISSIONS.coreAuditOutboxTestWrite],
      roles: ['bootstrap'],
      sourceApp: 'npp-core-api',
    },
  });

  await assert.rejects(
    withAuditOutboxTransaction({
      adapter,
      mutate: async (client, { buildAuditRecord, buildOutboxEvent, insertAuditRecord, insertOutboxEvent }) => {
        const auditRecord = buildAuditRecord({
          requestContext,
          action: 'test.fail',
          resourceType: 'test',
          afterData: { value: 'ok' },
        });
        const outboxEvent = buildOutboxEvent({
          requestContext,
          aggregateType: 'test',
          aggregateId: 'id-1',
          eventType: 'test.failed',
          eventVersion: 1,
          payload: { value: 'ok' },
        });
        await insertAuditRecord(client, auditRecord);
        await insertOutboxEvent(client, outboxEvent);
      },
    }),
    /simulated database failure/,
  );

  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('audit-only transaction commits without outbox event', async () => {
  const client = createFakeClient();
  const adapter = createFakeAdapter(client);
  const requestContext = createRequestContext({
    config: testConfig(),
    principal: {
      actorId: 'bootstrap:core-api',
      permissions: [PERMISSIONS.coreAuditOutboxTestWrite],
      roles: ['bootstrap'],
      sourceApp: 'npp-core-api',
    },
  });

  await withAuditOutboxTransaction({
    adapter,
    mutate: async (client, { buildAuditRecord, insertAuditRecord }) => {
      const auditRecord = buildAuditRecord({
        requestContext,
        action: 'test.audit_only',
        resourceType: 'test',
        afterData: { value: 'audit-only' },
      });
      await insertAuditRecord(client, auditRecord);
      return { auditId: auditRecord.auditId };
    },
  });

  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
  assert.ok(client.calls.some((call) => call.sql.startsWith('INSERT INTO shared.core_audit_records')));
  assert.ok(!client.calls.some((call) => call.sql.startsWith('INSERT INTO shared.core_outbox_events')));
});

test('POST /api/audit-outbox-test writes audit and outbox from server-owned context', async () => {
  const client = createFakeClient();
  const adapter = createFakeAdapter(client);

  const localServer = await startServer({
    config: testConfig({ PORT: '3108' }),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
    auditOutboxAdapter: adapter,
  });

  try {
    const response = await fetch('http://127.0.0.1:3108/api/audit-outbox-test', {
      method: 'POST',
      headers: authorizedHeaders(),
      body: JSON.stringify({ message: 'ready', secret: 'should-redact' }),
    });

    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.data.auditId);
    assert.ok(body.data.eventId);

    const auditCall = client.calls.find((call) => call.sql.startsWith('INSERT INTO shared.core_audit_records'));
    const outboxCall = client.calls.find((call) => call.sql.startsWith('INSERT INTO shared.core_outbox_events'));
    assert.ok(auditCall);
    assert.ok(outboxCall);
    assert.equal(auditCall.values[1], 'npp-hung-phat');
    assert.equal(auditCall.values[2], 'bootstrap:core-api');
    assert.equal(auditCall.values[0], body.data.auditId);
    assert.equal(outboxCall.values[1], 'npp-hung-phat');
    assert.equal(outboxCall.values[0], body.data.eventId);
    assert.equal(outboxCall.values[6].secret, null);
  } finally {
    await closeServer(localServer);
  }
});

test('spoofed identity headers do not affect audit/outbox identity', async () => {
  const client = createFakeClient();
  const adapter = createFakeAdapter(client);

  const localServer = await startServer({
    config: testConfig({ PORT: '3109' }),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
    auditOutboxAdapter: adapter,
  });

  try {
    const response = await fetch('http://127.0.0.1:3109/api/audit-outbox-test', {
      method: 'POST',
      headers: {
        ...authorizedHeaders(),
        'x-actor-id': 'spoofed',
        'x-installation-id': 'spoofed',
        'x-source-app': 'spoofed-app',
      },
      body: JSON.stringify({ message: 'safe' }),
    });

    const body = await response.json();
    assert.equal(response.status, 200);

    const auditCall = client.calls.find((call) => call.sql.startsWith('INSERT INTO shared.core_audit_records'));
    assert.equal(auditCall.values[1], 'npp-hung-phat');
    assert.equal(auditCall.values[2], 'bootstrap:core-api');
    assert.equal(auditCall.values[4], 'npp-core-api');
  } finally {
    await closeServer(localServer);
  }
});

test('route rejects requests without the audit/outbox permission', async () => {
  const localServer = await startServer({
    config: testConfig({ PORT: '3110' }),
    queryFn: async () => ({ rows: [{ ok: 1 }] }),
    auditOutboxAdapter: createFakeAdapter(createFakeClient()),
    authenticateRequest: () => ({
      ok: true,
      principal: {
        actorId: 'bootstrap:test',
        roles: ['bootstrap'],
        permissions: [PERMISSIONS.coreConfigRead],
        sourceApp: 'test-runner',
      },
    }),
  });

  try {
    const response = await fetch('http://127.0.0.1:3110/api/audit-outbox-test', {
      method: 'POST',
      headers: authorizedHeaders(),
      body: JSON.stringify({ message: 'no access' }),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'FORBIDDEN');
  } finally {
    await closeServer(localServer);
  }
});
