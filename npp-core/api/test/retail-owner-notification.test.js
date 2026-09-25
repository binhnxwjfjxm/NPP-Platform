import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  isRetailOwner,
  normalizeRetailPushSubscription,
  retailOwnerNotificationInternals,
  retailOwnerUserId,
  retailWebPushPublicConfig,
  sendRetailOwnerWebPush,
} from '../src/services/retail-owner-notification.js';
import { buildWebPushRequest } from '../src/services/retail-web-push-crypto.js';
import { manualSalesOrderRouteInternals } from '../src/routes/manual-sales-orders.js';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

function rawPublicKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]).toString('base64url');
}

function vapidEnv() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateJwk = pair.privateKey.export({ format: 'jwk' });
  return {
    RETAIL_WEB_PUSH_VAPID_PUBLIC_KEY: rawPublicKey(pair.publicKey),
    RETAIL_WEB_PUSH_VAPID_PRIVATE_KEY: privateJwk.d,
    RETAIL_WEB_PUSH_VAPID_SUBJECT: 'https://retail.example.test',
  };
}

function browserSubscription() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    endpoint: 'https://push.example.test/send/device-1',
    expirationTime: null,
    keys: {
      p256dh: rawPublicKey(pair.publicKey),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

test('Retail push công nhận cả Security Owner và Implementation Owner canonical', () => {
  const owner = { actorId: `user:${OWNER_ID}`, roles: ['system:security-owner'], sourceApp: 'retail-web' };
  assert.equal(isRetailOwner(owner), true);
  assert.equal(retailOwnerUserId(owner), OWNER_ID);
  assert.equal(isRetailOwner({ ...owner, roles: ['system:implementation-owner'] }), true);
  assert.equal(isRetailOwner({ ...owner, roles: ['sales-manager'] }), false);
  assert.equal(isRetailOwner({ ...owner, actorId: 'bootstrap:core-api' }), false);
});

test('subscription Web Push chỉ nhận endpoint https và khóa Push API hợp lệ', () => {
  const input = browserSubscription();
  const normalized = normalizeRetailPushSubscription(input);
  assert.equal(normalized.endpoint, input.endpoint);
  assert.equal(normalized.endpointHash.length, 64);
  assert.equal(normalized.keys.p256dh, input.keys.p256dh);
  assert.throws(
    () => normalizeRetailPushSubscription({ ...input, endpoint: 'http://push.example.test/device' }),
    /invalid_subscription/,
  );
});

test('VAPID config chỉ trả public key, không bao giờ trả private key', () => {
  const env = vapidEnv();
  const config = retailWebPushPublicConfig(env);
  assert.equal(config.configured, true);
  assert.equal(config.publicKey, env.RETAIL_WEB_PUSH_VAPID_PUBLIC_KEY);
  assert.equal(Object.prototype.hasOwnProperty.call(config, 'privateKey'), false);
});

test('Web Push request dùng VAPID + aes128gcm và gửi trực tiếp tới browser push endpoint', () => {
  const env = vapidEnv();
  const runtime = retailOwnerNotificationInternals.runtimeConfig(env);
  const subscription = browserSubscription();
  const request = buildWebPushRequest(subscription, {
    type: 'retail_notification_test',
    title: 'Bán tại quầy',
    body: 'Thông báo thử',
    url: '/',
  }, runtime, { nowMs: 1_800_000_000_000 });

  assert.equal(request.endpoint, subscription.endpoint);
  assert.match(request.headers.Authorization, /^vapid t=/);
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(request.headers.Urgency, 'high');
  assert.ok(Buffer.isBuffer(request.body));
  assert.ok(request.body.length > 100);
  assert.doesNotMatch(JSON.stringify(request.headers), /onesignal|r2|audio/i);
});

test('gửi đơn tới subscription Owner và đánh dấu gửi thành công', async () => {
  const env = vapidEnv();
  const subscription = browserSubscription();
  const sqlCalls = [];
  let request = null;
  const db = {
    async query(sql, values) {
      const statement = String(sql);
      sqlCalls.push(statement);
      if (statement.includes('FROM shared.retail_web_push_subscriptions s')) {
        assert.deepEqual(values, ['installation-a']);
        return {
          rows: [{
            endpoint_hash: 'a'.repeat(64),
            user_id: OWNER_ID,
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth_secret: subscription.keys.auth,
            expiration_time: null,
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const result = await sendRetailOwnerWebPush({
    db,
    installationId: 'installation-a',
    order: { id: ORDER_ID, number: 'SO-000839', total: '486000' },
    env,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.sentCount, 1);
  assert.equal(request.url, subscription.endpoint);
  assert.match(request.options.headers.Authorization, /^vapid t=/);
  assert.ok(sqlCalls.some((sql) => sql.includes('owner_kind IN')));
  assert.ok(sqlCalls.some((sql) => sql.includes('last_success_at = now()')));
});

test('thiếu VAPID không gọi push endpoint', async () => {
  let calls = 0;
  const result = await sendRetailOwnerWebPush({
    db: { query: async () => ({ rows: [] }) },
    installationId: 'installation-a',
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
