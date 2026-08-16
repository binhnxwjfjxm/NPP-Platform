import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const TECHNICAL_BACKUP_RECIPIENT = 'khuongbinh.info@gmail.com';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHALLENGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{32,128})$/i;
const DEFAULT_CHALLENGE_TTL_SECONDS = 5 * 60;
const DEFAULT_UNLOCK_TTL_SECONDS = 10 * 60;
const DEFAULT_MAX_ATTEMPTS = 5;
const EMAIL_TIMEOUT_MS = 5_000;

function text(value) { return String(value ?? '').trim(); }
function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function safeEqualHex(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue ?? ''), 'hex');
  const right = Buffer.from(String(rightValue ?? ''), 'hex');
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right);
}

export function loadTechnicalBackupAccessRuntime({ env = process.env } = {}) {
  return Object.freeze({
    accountId: text(env.CLOUDFLARE_ACCOUNT_ID),
    apiToken: text(env.CLOUDFLARE_EMAIL_API_TOKEN),
    from: text(env.INTERNAL_AUTH_EMAIL_FROM),
    pepper: text(env.INTERNAL_AUTH_CHALLENGE_PEPPER),
    challengeTtlSeconds: boundedInteger(
      env.TECHNICAL_BACKUP_CHALLENGE_TTL_SECONDS,
      DEFAULT_CHALLENGE_TTL_SECONDS,
      60,
      900,
    ),
    unlockTtlSeconds: boundedInteger(
      env.TECHNICAL_BACKUP_UNLOCK_TTL_SECONDS,
      DEFAULT_UNLOCK_TTL_SECONDS,
      60,
      1800,
    ),
    maxAttempts: boundedInteger(
      env.TECHNICAL_BACKUP_CHALLENGE_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS,
      1,
      10,
    ),
    recipient: TECHNICAL_BACKUP_RECIPIENT,
  });
}

export function technicalBackupAccessRuntimeReady(runtime, fetchImpl = globalThis.fetch) {
  return Boolean(
    runtime?.accountId
    && runtime?.apiToken
    && EMAIL_PATTERN.test(runtime?.from ?? '')
    && runtime?.pepper?.length >= 32
    && runtime?.recipient === TECHNICAL_BACKUP_RECIPIENT
    && typeof fetchImpl === 'function'
  );
}

export function generateTechnicalBackupCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashTechnicalBackupCode(runtime, challengeId, code) {
  if (!CHALLENGE_ID_PATTERN.test(String(challengeId ?? ''))) throw new Error('TECHNICAL_BACKUP_CHALLENGE_ID_INVALID');
  return createHmac('sha256', runtime.pepper)
    .update(`technical-backup-challenge:${challengeId}:${String(code)}`)
    .digest('hex');
}

export function technicalBackupCodeMatches(expectedHash, actualHash) {
  return safeEqualHex(expectedHash, actualHash);
}

export function issueTechnicalBackupUnlockToken(runtime, challengeId) {
  if (!CHALLENGE_ID_PATTERN.test(String(challengeId ?? ''))) throw new Error('TECHNICAL_BACKUP_CHALLENGE_ID_INVALID');
  const secret = randomBytes(32).toString('base64url');
  const token = `${challengeId}.${secret}`;
  return Object.freeze({ token, tokenHash: hashTechnicalBackupUnlockToken(runtime, challengeId, token) });
}

export function parseTechnicalBackupUnlockToken(value) {
  const token = text(value);
  const match = TOKEN_PATTERN.exec(token);
  return match ? Object.freeze({ challengeId: match[1], token }) : null;
}

export function hashTechnicalBackupUnlockToken(runtime, challengeId, token) {
  return createHmac('sha256', runtime.pepper)
    .update(`technical-backup-unlock:${challengeId}:${String(token)}`)
    .digest('hex');
}

export function technicalBackupUnlockTokenMatches(expectedHash, actualHash) {
  return safeEqualHex(expectedHash, actualHash);
}

export async function sendTechnicalBackupAccessEmail(fetchImpl, runtime, { code }) {
  if (!technicalBackupAccessRuntimeReady(runtime, fetchImpl)) throw new Error('TECHNICAL_BACKUP_ACCESS_UNAVAILABLE');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(runtime.accountId)}/email/sending/send`;
  const minutes = Math.ceil(runtime.challengeTtlSeconds / 60);
  const subject = 'Mã mở khóa Khu vực kỹ thuật Hưng Phát';
  const bodyText = `Có yêu cầu mở Khu vực kỹ thuật sao lưu hệ thống Công Ty. Mã xác nhận: ${code}. Mã hết hạn sau ${minutes} phút. Mã này chỉ dùng cho sao lưu kỹ thuật; không dùng để xác nhận xóa dữ liệu.`;
  const bodyHtml = `<p>Có yêu cầu mở <strong>Khu vực kỹ thuật sao lưu hệ thống Công Ty</strong>.</p><p>Mã xác nhận: <strong>${code}</strong></p><p>Mã hết hạn sau ${minutes} phút.</p><p>Mã này chỉ dùng cho sao lưu kỹ thuật; không dùng để xác nhận xóa dữ liệu.</p>`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${runtime.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: [TECHNICAL_BACKUP_RECIPIENT],
      from: { address: runtime.from, name: 'Hưng Phát Security' },
      subject,
      text: bodyText,
      html: bodyHtml,
    }),
  });
  if (!response?.ok) throw new Error('TECHNICAL_BACKUP_CHALLENGE_DELIVERY_FAILED');
  const payload = await response.json().catch(() => null);
  const result = payload?.result;
  const accepted = new Set([
    ...(Array.isArray(result?.delivered) ? result.delivered : []),
    ...(Array.isArray(result?.queued) ? result.queued : []),
  ].map((email) => String(email).trim().toLowerCase()));
  const permanentBounces = Array.isArray(result?.permanent_bounces) ? result.permanent_bounces : [];
  if (!payload?.success || permanentBounces.length > 0 || !accepted.has(TECHNICAL_BACKUP_RECIPIENT)) {
    throw new Error('TECHNICAL_BACKUP_CHALLENGE_DELIVERY_FAILED');
  }
  return Object.freeze({ recipient: TECHNICAL_BACKUP_RECIPIENT });
}
