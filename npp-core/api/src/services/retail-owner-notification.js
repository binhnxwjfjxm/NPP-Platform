const ONESIGNAL_PUSH_ENDPOINT = 'https://api.onesignal.com/notifications?c=push';
const PERMANENT_OWNER_ROLE = 'system:security-owner';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_TIMEOUT_MS = 4_000;

function text(value) {
  return String(value ?? '').trim();
}

function runtimeConfig(env = process.env) {
  const appId = text(env.RETAIL_ONESIGNAL_APP_ID);
  const apiKey = text(env.RETAIL_ONESIGNAL_API_KEY);
  const rawRetailUrl = text(env.RETAIL_PUBLIC_URL);
  let retailUrl = '';
  if (rawRetailUrl) {
    try {
      const url = new URL(rawRetailUrl);
      const loopback = new Set(['127.0.0.1', 'localhost', '::1']).has(url.hostname);
      if (['http:', 'https:'].includes(url.protocol)
          && !url.username
          && !url.password
          && (env.NODE_ENV !== 'production' || url.protocol === 'https:' || loopback)) {
        url.pathname = url.pathname.replace(/\/$/, '');
        url.search = '';
        url.hash = '';
        retailUrl = url.toString().replace(/\/$/, '');
      }
    } catch {
      retailUrl = '';
    }
  }
  return Object.freeze({
    appId,
    apiKey,
    retailUrl,
    configured: UUID_PATTERN.test(appId) && apiKey.length >= 20 && Boolean(retailUrl),
  });
}

function compactOrderLabel(order = {}) {
  const number = text(order.number) || 'Đơn bán hàng mới';
  const raw = text(order.total);
  const money = /^-?\d+(?:\.\d+)?$/.test(raw)
    ? raw.split('.')[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    : '';
  return money ? `${number} · ${money} đ` : number;
}

export function isPermanentRetailOwner(requestContext = {}) {
  const actorId = text(requestContext.actorId);
  return Array.isArray(requestContext.roles)
    && requestContext.roles.includes(PERMANENT_OWNER_ROLE)
    && actorId.startsWith('user:')
    && UUID_PATTERN.test(actorId.slice('user:'.length));
}

export function retailOwnerExternalId(requestContext = {}) {
  if (!isPermanentRetailOwner(requestContext)) return '';
  const value = text(requestContext.actorId).slice('user:'.length);
  return UUID_PATTERN.test(value) ? value : '';
}

export async function listPermanentRetailOwnerExternalIds(db, { installationId }) {
  const result = await db.query(
    `SELECT b.user_id::text AS user_id
       FROM shared.security_owner_bindings b
       JOIN shared.users u
         ON u.installation_id = b.installation_id
        AND u.id = b.user_id
        AND u.is_active = true
       JOIN shared.employees e
         ON e.installation_id = u.installation_id
        AND e.id = u.employee_id
        AND e.is_active = true
      WHERE b.installation_id = $1
        AND b.owner_kind = 'PERMANENT'
      ORDER BY b.user_id`,
    [installationId],
  );
  return [...new Set((result.rows ?? [])
    .map((row) => text(row.user_id))
    .filter((value) => UUID_PATTERN.test(value)))];
}

function providerFailure(code, message, retryable) {
  return Object.freeze({ ok: false, code, message, retryable, recipientCount: 0 });
}

export async function sendRetailOwnerPush({
  db,
  installationId,
  order = {},
  recipientExternalIds,
  test = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const runtime = runtimeConfig(env);
  if (!runtime.configured || typeof fetchImpl !== 'function') {
    return providerFailure('RETAIL_PUSH_NOT_CONFIGURED', 'Thông báo Retail chưa được cấu hình', true);
  }

  let recipients = Array.isArray(recipientExternalIds)
    ? recipientExternalIds.map(text).filter((value) => UUID_PATTERN.test(value))
    : null;
  if (!recipients) {
    if (!db || typeof db.query !== 'function') {
      return providerFailure('RETAIL_PUSH_STORAGE_UNAVAILABLE', 'Không đọc được danh sách Owner nhận thông báo', true);
    }
    recipients = await listPermanentRetailOwnerExternalIds(db, { installationId });
  }
  recipients = [...new Set(recipients)];
  if (recipients.length === 0) {
    return Object.freeze({
      ok: true,
      code: 'RETAIL_PUSH_NO_ACTIVE_OWNER',
      skipped: true,
      recipientCount: 0,
      messageId: null,
    });
  }

  const orderId = UUID_PATTERN.test(text(order.id)) ? text(order.id) : null;
  const label = compactOrderLabel(order);
  const body = test
    ? 'Thông báo thử từ Bán tại quầy đã hoạt động.'
    : `Có đơn mới cần kiểm tra thanh toán · ${label}`;
  const payload = {
    app_id: runtime.appId,
    target_channel: 'push',
    include_aliases: { external_id: recipients },
    headings: { en: 'Bán tại quầy' },
    contents: { en: body },
    url: runtime.retailUrl,
    data: {
      type: test ? 'retail_notification_test' : 'retail_order_payment_check',
      ...(orderId ? { salesOrderId: orderId } : {}),
      orderNumber: text(order.number) || null,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetchImpl(ONESIGNAL_PUSH_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Key ${runtime.apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      return providerFailure(
        'RETAIL_PUSH_PROVIDER_REJECTED',
        'Dịch vụ thông báo từ chối yêu cầu',
        response.status >= 500 || response.status === 429,
      );
    }
    return Object.freeze({
      ok: true,
      code: 'RETAIL_PUSH_SENT',
      skipped: false,
      recipientCount: recipients.length,
      messageId: text(responseBody?.id) || null,
    });
  } catch {
    return providerFailure('RETAIL_PUSH_PROVIDER_UNAVAILABLE', 'Dịch vụ thông báo tạm thời chưa sẵn sàng', true);
  } finally {
    clearTimeout(timeout);
  }
}

export const retailOwnerPushInternals = Object.freeze({
  runtimeConfig,
  compactOrderLabel,
  ONESIGNAL_PUSH_ENDPOINT,
});
