import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { loadResendEmailRuntime, resendEmailRuntimeReady, sendResendEmail } from '../email/resend.js';

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
    ...loadResendEmailRuntime({ env }),
    pepper: text(env.INTERNAL_AUTH_CHALLENGE_PEPPER),
    ttlSeconds: boundedInteger(env.DATA_DELETION_CHALLENGE_TTL_SECONDS, DEFAULT_TTL_SECONDS, 60, 900),
    maxAttempts: boundedInteger(env.DATA_DELETION_CHALLENGE_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 10),
    recipients: Object.freeze(recipients),
  });
}

export function ownerDeletionRuntimeReady(runtime, fetchImpl = globalThis.fetch) {
  return Boolean(
    resendEmailRuntimeReady(runtime, fetchImpl)
    && runtime?.pepper?.length >= 32
    && Array.isArray(runtime?.recipients)
    && runtime.recipients.length > 0
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

export async function sendOwnerDeletionChallengeEmail(fetchImpl, runtime, { code, sourceApp, intentId }) {
  if (!ownerDeletionRuntimeReady(runtime, fetchImpl)) throw new Error('DATA_DELETION_CHALLENGE_UNAVAILABLE');
  const subject = 'Mã xác nhận yêu cầu xóa dữ liệu Hưng Phát';
  const minutes = Math.ceil(runtime.ttlSeconds / 60);
  const bodyText = `Có yêu cầu xác minh xóa dữ liệu từ ${sourceApp}. Mã xác nhận: ${code}. Mã hết hạn sau ${minutes} phút. Chỉ nhập mã trong mục Cài đặt > Dữ liệu & sao lưu. Nếu không phải yêu cầu của bạn, không cung cấp mã này.`;
  const bodyHtml = `<p>Có yêu cầu xác minh <strong>xóa dữ liệu</strong> từ ${sourceApp}.</p><p>Mã xác nhận: <strong>${code}</strong></p><p>Mã hết hạn sau ${minutes} phút.</p><p>Chỉ nhập mã trong mục Cài đặt &gt; Dữ liệu &amp; sao lưu. Nếu không phải yêu cầu của bạn, không cung cấp mã này.</p>`;
  try {
    await sendResendEmail(fetchImpl, runtime, { to: runtime.recipients, subject, text: bodyText, html: bodyHtml, operation: 'data-deletion-challenge-email', entityId: intentId });
    return Object.freeze({ recipientCount: runtime.recipients.length });
  } catch { throw new Error('DATA_DELETION_CHALLENGE_DELIVERY_FAILED'); }
}
