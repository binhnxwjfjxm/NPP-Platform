import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreApiServer } from '../src/server.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function idempotencyStore() {
  return {
    async reserve(_scope, requestFingerprint, requestId) {
      return {
        created: true,
        record: {
          request_fingerprint: requestFingerprint,
          request_id: requestId,
          status: 'processing',
        },
      };
    },
    async markCompleted() {},
    async markFailed() {},
    async reclaimFailed() {
      return { claimed: false, record: null };
    },
  };
}

test('Công Ty server wires the Admin Assistant route through the real HTTP dispatcher', async () => {
  let gatewayCalls = 0;
  const server = createCoreApiServer({
    config: {
      corsOrigins: [],
      r2ContractRouteEnabled: false,
    },
    queryFn: async () => {},
    authenticateRequest: () => ({
      ok: true,
      principal: {
        actorId: 'owner:test',
        roles: ['system:implementation-owner'],
        permissions: [],
        sourceApp: 'admin',
      },
    }),
    createAnonymousPrincipal: () => ({
      actorId: 'anonymous:test',
      roles: [],
      permissions: [],
      sourceApp: 'test',
    }),
    createRequestContext: ({ principal, requestId, receivedAt }) => ({
      actorId: principal.actorId,
      roles: principal.roles ?? [],
      permissions: principal.permissions ?? [],
      sourceApp: principal.sourceApp ?? 'test',
      installationId: 'test-installation',
      requestId,
      receivedAt,
      authContext: {},
    }),
    requirePermission: () => ({ ok: true }),
    idempotencyStore: idempotencyStore(),
    auditOutboxAdapter: {},
    storageAdapter: {},
    env: {
      ADMIN_AI_GATEWAY_BASE_URL: 'https://assistant-gateway.example',
      WEBSITE_AI_API_TOKEN: 'website-ai-test-token',
      ADMIN_AI_AGENT_MODEL: 'gemini-2.5-pro',
    },
    fetchImpl: async (url, init) => {
      gatewayCalls += 1;
      assert.equal(url, 'https://assistant-gateway.example/api/admin-agent/gateway');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.authorization, 'Bearer website-ai-test-token');
      assert.equal(init.headers['x-company-admin-ai-gateway'], 'company-admin');
      assert.deepEqual(JSON.parse(init.body), {
        actorId: 'owner:test',
        conversationId: 'conversation-1',
        message: 'Tóm tắt tình hình hôm nay',
      });
      return new Response(JSON.stringify({
        ok: true,
        capability: 'company-admin-ai',
        readOnly: true,
        replyText: 'Tình hình hôm nay ổn định.',
        conversationId: 'conversation-1',
        providerRequestId: 'provider-request-1',
        model: 'gemini-2.5-pro',
        occurredAt: '2026-08-29T12:00:00.000Z',
        usageMetadata: null,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/admin-assistant`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer owner-test-token',
        'content-type': 'application/json',
        'idempotency-key': 'admin-assistant-00000000-0000-4000-8000-000000000001',
      },
      body: JSON.stringify({
        conversationId: 'conversation-1',
        message: 'Tóm tắt tình hình hôm nay',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(gatewayCalls, 1);
    assert.equal(payload.data.replyText, 'Tình hình hôm nay ổn định.');
    assert.equal(payload.data.conversationId, 'conversation-1');
    assert.equal(payload.data.usageRecorded, false);
    assert.equal(payload.data.usage, null);
    assert.equal(payload.data.readOnly, true);
    assert.equal(typeof payload.requestId, 'string');
    assert.equal(typeof payload.receivedAt, 'string');
  } finally {
    console.error = originalConsoleError;
    await close(server);
  }
});
