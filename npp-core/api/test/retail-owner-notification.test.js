import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRetailOwner,
  listRetailOwnerExternalIds,
  retailOwnerExternalId,
  retailOwnerPushInternals,
  sendRetailOwnerPush,
} from '../src/services/retail-owner-notification.js';
import { manualSalesOrderRouteInternals } from '../src/routes/manual-sales-orders.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

function env() {
  return {
    NODE_ENV: 'test',
    RETAIL_ONESIGNAL_APP_ID: '33333333-3333-4333-8333-333333333333',
    RETAIL_ONESIGNAL_API_KEY: 'test-api-key-012345678901234567890',
    RETAIL_PUBLIC_URL: 'https://retail.example.test',
  };
}

test('Retail push công nhận cả Security Owner và Implementation Owner canonical', () => {
  const owner = { actorId: `user:${OWNER_ID}`, roles: ['system:security-owner'], sourceApp: 'retail-web' };
  assert.equal(isRetailOwner(owner), true);
  assert.equal(retailOwnerExternalId(owner), OWNER_ID);
  assert.equal(isRetailOwner({ ...owner, roles: ['system:implementation-owner'] }), true);
  assert.equal(isRetailOwner({ ...owner, roles: ['sales-manager'] }), false);
  assert.equal(isRetailOwner({ ...owner, actorId: 'bootstrap:core-api' }), false);
});

test('danh sách nhận push lấy cả permanent và temporary Owner đang hoạt động', async () => {
  let capturedSql = '';
  const db = {
    async query(sql, values) {
      capturedSql = String(sql);
      assert.deepEqual(values, ['installation-a']);
      return { rows: [{ user_id: OWNER_ID }, { user_id: OWNER_ID }] };
    },
  };
  const ids = await listRetailOwnerExternalIds(db, { installationId: 'installation-a' });
  assert.deepEqual(ids, [OWNER_ID]);
  assert.match(capturedSql, /owner_kind IN \('PERMANENT', 'TEMPORARY'\)/);
  assert.match(capturedSql, /u\.is_active = true/);
  assert.match(capturedSql, /e\.is_active = true/);
});

test('OneSignal payload dùng external_id của Owner, URL Retail và không chứa âm tùy chỉnh', async () => {
  let request = null;
  const result = await sendRetailOwnerPush({
    installationId: 'installation-a',
    recipientExternalIds: [OWNER_ID],
    order: { id: ORDER_ID, number: 'SO-000839', total: '486000' },
    env: env(),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ id: 'notification-1' }) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.recipientCount, 1);
  assert.equal(request.url, retailOwnerPushInternals.ONESIGNAL_PUSH_ENDPOINT);
  assert.match(request.options.headers.Authorization, /^Key /);
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.include_aliases.external_id, [OWNER_ID]);
  assert.equal(payload.target_channel, 'push');
  assert.equal(payload.url, `https://retail.example.test/?order=${ORDER_ID}`);
  assert.equal(payload.data.salesOrderId, ORDER_ID);
  assert.match(payload.contents.en, /SO-000839/);
  assert.doesNotMatch(request.options.body, /sound|audio|r2/i);
});

test('thiếu cấu hình OneSignal không gọi provider', async () => {
  let calls = 0;
  const result = await sendRetailOwnerPush({
    installationId: 'installation-a',
    recipientExternalIds: [OWNER_ID],
    env: {},
    fetchImpl: async () => { calls += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RETAIL_PUSH_NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('push đơn Retail chỉ chạy sau complete thành công, không chạy lại khi idempotency replay', () => {
  const should = manualSalesOrderRouteInternals.shouldSendRetailOwnerCompletionPush;
  const base = {
    routeBase: 'pickup-sales-orders',
    action: 'complete',
    requestContext: { sourceApp: 'retail-web' },
    execution: { replayed: false, response: { statusCode: 200, body: { data: { id: ORDER_ID } } } },
  };
  assert.equal(should(base), true);
  assert.equal(should({ ...base, action: 'settlement' }), false);
  assert.equal(should({ ...base, execution: { ...base.execution, replayed: true } }), false);
  assert.equal(should({ ...base, requestContext: { sourceApp: 'npp-operations-web' } }), false);
  assert.equal(should({ ...base, execution: { ...base.execution, response: { statusCode: 503 } } }), false);
});
