import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_TTL_SECONDS = 5 * 60;
const DEFAULT_MAX_ATTEMPTS = 5;
const EMAIL_TIMEOUT_MS = 5_000;

function text(value) { return String(value ?? '').trim(); }
function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function normalizedEmails(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value).toLowerCase())
    .filter((value) => EMAIL_PATTERN.test(value) && value.length <= 256))];
}

export function loadOwnerDeletionChallengeRuntime({ env = process.env, ownerConfig = null } = {}) {
  const securityOwnerEmails = ownerConfig?.securityOwnerEmails ?? text(env.SECURITY_OWNER_EMAILS).split(',');
  const implementationOwnerEmails = ownerConfig?.implementationOwnerEmails ?? text(env.IMPLEMENTATION_OWNER_EMAILS).split(',');
  const recipients = normalizedEmails([...securityOwnerEmails, ...implementationOwnerEmails]);
  return Object.freeze({
    accountId: text(env.CLOUDFLARE_ACCOUNT_ID),
    apiToken: text(env.CLOUDFLARE_EMAIL_API_TOKEN),
    from: text(env.INTERNAL_AUTH_EMAIL_FROM),
    pepper: text(env.INTERNAL_AUTH_CHALLENGE_PEPPER),
    ttlSeconds: boundedInteger(env.DATA_DELETION_CHALLENGE_TTL_SECONDS, DEFAULT_TTL_SECONDS, 60, 900),
    maxAttempts: boundedInteger(env.DATA_DELETION_CHALLENGE_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 10),
    recipients: Object.freeze(recipients),
  });
}

export function ownerDeletionRuntimeReady(runtime, fetchImpl = globalThis.fetch) {
  return Boolean(
    runtime?.accountId
    && runtime?.apiToken
    && EMAIL_PATTERN.test(runtime?.from ?? '')
    && runtime?.pepper?.length >= 32
    && Array.isArray(runtime?.recipients)
    && runtime.recipients.length > 0
    && typeof fetchImpl === 'function'
  );
}

export function generateOwnerDeletionCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOwnerDeletionCode(runtime, intentId, code) {
  return createHmac('sha256', runtime.pepper)
    .update(`data-deletion:${intentId}:${String(code)}`)
    .digest('hex');
}

export function ownerDeletionCodeMatches(expectedHash, actualHash) {
  const left = Buffer.from(String(expectedHash ?? ''), 'hex');
  const right = Buffer.from(String(actualHash ?? ''), 'hex');
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

export async function sendOwnerDeletionChallengeEmail(fetchImpl, runtime, { code, sourceApp }) {
  if (!ownerDeletionRuntimeReady(runtime, fetchImpl)) throw new Error('DATA_DELETION_CHALLENGE_UNAVAILABLE');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(runtime.accountId)}/email/sending/send`;
  const subject = 'Mã xác nhận yêu cầu xóa dữ liệu Hưng Phát';
  const minutes = Math.ceil(runtime.ttlSeconds / 60);
  const bodyText = `Có yêu cầu xác minh xóa dữ liệu từ ${sourceApp}. Mã xác nhận: ${code}. Mã hết hạn sau ${minutes} phút. Chỉ nhập mã trong mục Cài đặt > Dữ liệu & sao lưu. Nếu không phải yêu cầu của bạn, không cung cấp mã này.`;
  const bodyHtml = `<p>Có yêu cầu xác minh <strong>xóa dữ liệu</strong> từ ${sourceApp}.</p><p>Mã xác nhận: <strong>${code}</strong></p><p>Mã hết hạn sau ${minutes} phút.</p><p>Chỉ nhập mã trong mục Cài đặt &gt; Dữ liệu &amp; sao lưu. Nếu không phải yêu cầu của bạn, không cung cấp mã này.</p>`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${runtime.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: runtime.recipients,
      from: { address: runtime.from, name: 'Hưng Phát Security' },
      subject,
      text: bodyText,
      html: bodyHtml,
    }),
  });
  if (!response?.ok) throw new Error('DATA_DELETION_CHALLENGE_DELIVERY_FAILED');
  const payload = await response.json().catch(() => null);
  const result = payload?.result;
  const accepted = new Set([
    ...(Array.isArray(result?.delivered) ? result.delivered : []),
    ...(Array.isArray(result?.queued) ? result.queued : []),
  ].map((email) => String(email).trim().toLowerCase()));
  const permanentBounces = Array.isArray(result?.permanent_bounces) ? result.permanent_bounces : [];
  if (!payload?.success || permanentBounces.length > 0 || runtime.recipients.some((email) => !accepted.has(email))) {
    throw new Error('DATA_DELETION_CHALLENGE_DELIVERY_FAILED');
  }
  return Object.freeze({ recipientCount: runtime.recipients.length });
}
