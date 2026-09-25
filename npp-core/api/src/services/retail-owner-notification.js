import { createHash } from 'node:crypto';
import {
  disableRetailWebPushSubscription,
  listRetailOwnerWebPushSubscriptions,
  listRetailWebPushSubscriptionsForUser,
  markRetailWebPushFailure,
  markRetailWebPushSuccess,
  upsertRetailWebPushSubscription,
} from '../db/repositories/retail-web-push.js';
import { buildWebPushRequest, validateVapidRuntime } from './retail-web-push-crypto.js';

const RETAIL_OWNER_ROLES = new Set(['system:security-owner', 'system:implementation-owner']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENDPOINT_MAX = 4096;
const PROVIDER_TIMEOUT_MS = 5_000;

function text(value) {
  return String(value ?? '').trim();
}

function runtimeConfig(env = process.env) {
  const publicKey = text(env.RETAIL_WEB_PUSH_VAPID_PUBLIC_KEY);
  const privateKey = text(env.RETAIL_WEB_PUSH_VAPID_PRIVATE_KEY);
  const subject = text(env.RETAIL_WEB_PUSH_VAPID_SUBJECT) || 'https://retail.nguyenlieuhungphat.com';
  const runtime = Object.freeze({ publicKey, privateKey, subject });
  return Object.freeze({ ...runtime, configured: validateVapidRuntime(runtime) });
}

function endpointHash(endpoint) {
  return createHash('sha256').update(endpoint).digest('hex');
}

export function retailOwnerUserId(requestContext = {}) {
  const actorId = text(requestContext.actorId);
  if (!actorId.startsWith('user:')) return '';
  const value = actorId.slice('user:'.length);
  return UUID_PATTERN.test(value) ? value : '';
}

export function isRetailOwner(requestContext = {}) {
  return Array.isArray(requestContext.roles)
    && requestContext.roles.some((role) => RETAIL_OWNER_ROLES.has(role))
    && Boolean(retailOwnerUserId(requestContext));
}

function normalizeExpirationTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw Object.assign(new Error('invalid_expiration_time'), {
    code: 'RETAIL_PUSH_SUBSCRIPTION_INVALID',
    publicMessage: 'Thông tin thiết bị nhận thông báo không hợp lệ',
    statusCode: 400,
  });
  return date.toISOString();
}

export function normalizeRetailPushSubscription(input) {
  const endpoint = text(input?.endpoint);
  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    endpointUrl = null;
  }
  const p256dh = text(input?.keys?.p256dh);
  const auth = text(input?.keys?.auth);
  let p256dhBytes = null;
  let authBytes = null;
  try {
    p256dhBytes = Buffer.from(p256dh, 'base64url');
    authBytes = Buffer.from(auth, 'base64url');
  } catch {
    p256dhBytes = null;
    authBytes = null;
  }
  if (
    !endpointUrl
    || endpointUrl.protocol !== 'https:'
    || endpointUrl.username
    || endpointUrl.password
    || endpoint.length > ENDPOINT_MAX
    || !/^[A-Za-z0-9_-]{40,512}$/.test(p256dh)
    || !/^[A-Za-z0-9_-]{8,256}$/.test(auth)
    || p256dhBytes?.length !== 65
    || p256dhBytes?.[0] !== 0x04
    || !authBytes
    || authBytes.length < 16
  ) {
    throw Object.assign(new Error('invalid_subscription'), {
      code: 'RETAIL_PUSH_SUBSCRIPTION_INVALID',
      publicMessage: 'Thông tin thiết bị nhận thông báo không hợp lệ',
      statusCode: 400,
    });
  }
  return Object.freeze({
    endpoint,
    endpointHash: endpointHash(endpoint),
    keys: Object.freeze({ p256dh, auth }),
    expirationTime: normalizeExpirationTime(input?.expirationTime),
  });
}

export async function registerRetailOwnerWebPush({
  db,
  requestContext,
  subscription,
  userAgent,
}) {
  if (!isRetailOwner(requestContext)) {
    return Object.freeze({ ok: false, code: 'RETAIL_PUSH_OWNER_REQUIRED', message: 'Chỉ tài khoản Owner được bật thông báo', statusCode: 403 });
  }
  const normalized = normalizeRetailPushSubscription(subscription);
  const userId = retailOwnerUserId(requestContext);
  const row = await upsertRetailWebPushSubscription(db, {
    installationId: requestContext.installationId,
    userId,
    endpointHash: normalized.endpointHash,
    endpoint: normalized.endpoint,
    p256dh: normalized.keys.p256dh,
    authSecret: normalized.keys.auth,
    expirationTime: normalized.expirationTime,
    userAgent: text(userAgent).slice(0, 512) || null,
    actorId: requestContext.actorId,
  });
  return Object.freeze({ ok: true, subscription: row });
}

export async function unregisterRetailOwnerWebPush({
  db,
  requestContext,
  endpoint,
}) {
  if (!isRetailOwner(requestContext)) {
    return Object.freeze({ ok: false, code: 'RETAIL_PUSH_OWNER_REQUIRED', message: 'Chỉ tài khoản Owner được thay đổi thông báo', statusCode: 403 });
  }
  const normalizedEndpoint = text(endpoint);
  if (!normalizedEndpoint || normalizedEndpoint.length > ENDPOINT_MAX) {
    return Object.freeze({ ok: false, code: 'RETAIL_PUSH_SUBSCRIPTION_INVALID', message: 'Thông tin thiết bị nhận thông báo không hợp lệ', statusCode: 400 });
  }
  const row = await disableRetailWebPushSubscription(db, {
    installationId: requestContext.installationId,
    userId: retailOwnerUserId(requestContext),
    endpointHash: endpointHash(normalizedEndpoint),
    actorId: requestContext.actorId,
  });
  return Object.freeze({ ok: true, removed: Boolean(row) });
}

function notificationUrl(orderId) {
  return orderId && UUID_PATTERN.test(text(orderId)) ? `/?order=${text(orderId)}` : '/';
}

function compactOrderLabel(order = {}) {
  const number = text(order.number) || 'Đơn bán hàng mới';
  const raw = text(order.total);
  const money = /^-?\d+(?:\.\d+)?$/.test(raw)
    ? raw.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : '';
  return money ? `${number} · ${money} đ` : number;
}

function messagePayload(order, { test = false } = {}) {
  const orderId = UUID_PATTERN.test(text(order?.id)) ? text(order.id) : null;
  return Object.freeze({
    type: test ? 'retail_notification_test' : 'retail_order_payment_check',
    title: 'Bán tại quầy',
    body: test
      ? 'Thông báo thử từ Bán tại quầy đã hoạt động.'
      : `Có đơn mới cần kiểm tra thanh toán · ${compactOrderLabel(order)}`,
    url: notificationUrl(test ? null : orderId),
    salesOrderId: test ? null : orderId,
    orderNumber: text(order?.number) || null,
  });
}

async function sendOne(subscription, payload, runtime, fetchImpl) {
  let request;
  try {
    request = buildWebPushRequest({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth_secret,
      },
    }, payload, runtime);
  } catch {
    return Object.freeze({ ok: false, terminal: true, statusCode: 0, code: 'RETAIL_PUSH_SUBSCRIPTION_INVALID' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetchImpl(request.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: request.headers,
      body: request.body,
    });
    if (response.ok) return Object.freeze({ ok: true, terminal: false, statusCode: response.status });
    const terminal = response.status === 404 || response.status === 410;
    return Object.freeze({
      ok: false,
      terminal,
      statusCode: response.status,
      code: terminal ? 'RETAIL_PUSH_SUBSCRIPTION_EXPIRED' : 'RETAIL_PUSH_DELIVERY_REJECTED',
    });
  } catch {
    return Object.freeze({ ok: false, terminal: false, statusCode: 0, code: 'RETAIL_PUSH_DELIVERY_UNAVAILABLE' });
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendRetailOwnerWebPush({
  db,
  installationId,
  userId = null,
  order = {},
  test = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const runtime = runtimeConfig(env);
  if (!runtime.configured || typeof fetchImpl !== 'function') {
    return Object.freeze({ ok: false, code: 'RETAIL_PUSH_NOT_CONFIGURED', message: 'Kênh thông báo chưa được cấu hình', retryable: true, sentCount: 0, failedCount: 0 });
  }

  const subscriptions = userId
    ? await listRetailWebPushSubscriptionsForUser(db, { installationId, userId })
    : await listRetailOwnerWebPushSubscriptions(db, { installationId });

  if (subscriptions.length === 0) {
    return Object.freeze({ ok: true, code: 'RETAIL_PUSH_NO_SUBSCRIPTIONS', skipped: true, sentCount: 0, failedCount: 0 });
  }

  const payload = messagePayload(order, { test });
  let sentCount = 0;
  let failedCount = 0;
  for (const subscription of subscriptions) {
    const result = await sendOne(subscription, payload, runtime, fetchImpl);
    if (result.ok) {
      sentCount += 1;
      try {
        await markRetailWebPushSuccess(db, {
          installationId,
          endpointHash: subscription.endpoint_hash,
        });
      } catch {
        // Delivery already succeeded; status bookkeeping must not turn a successful push into a retry duplicate.
      }
    } else {
      failedCount += 1;
      try {
        await markRetailWebPushFailure(db, {
          installationId,
          endpointHash: subscription.endpoint_hash,
          terminal: result.terminal,
        });
      } catch {
        // Delivery failure remains authoritative even if cleanup bookkeeping is temporarily unavailable.
      }
    }
  }

  return Object.freeze({
    ok: sentCount > 0 || failedCount === 0,
    code: sentCount > 0 ? 'RETAIL_PUSH_SENT' : 'RETAIL_PUSH_DELIVERY_FAILED',
    message: sentCount > 0 ? 'Đã gửi thông báo' : 'Chưa gửi được thông báo',
    retryable: sentCount === 0 && failedCount > 0,
    skipped: false,
    sentCount,
    failedCount,
  });
}

export function retailWebPushPublicConfig(env = process.env) {
  const runtime = runtimeConfig(env);
  return Object.freeze({
    configured: runtime.configured,
    publicKey: runtime.configured ? runtime.publicKey : null,
  });
}

export const retailOwnerNotificationInternals = Object.freeze({
  runtimeConfig,
  endpointHash,
  retailOwnerUserId,
  compactOrderLabel,
  messagePayload,
});
