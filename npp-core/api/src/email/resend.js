import { createIdempotencyKey } from '@npp/contracts';

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_RESEND_EMAIL_TIMEOUT_MS = 5_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value) { return String(value ?? '').trim(); }
function boundedTimeout(value) {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 30_000 ? parsed : DEFAULT_RESEND_EMAIL_TIMEOUT_MS;
}
export function loadResendEmailRuntime({ env = process.env } = {}) {
  return Object.freeze({ apiKey: text(env.RESEND_API_KEY), from: text(env.INTERNAL_AUTH_EMAIL_FROM), timeoutMs: boundedTimeout(env.RESEND_EMAIL_TIMEOUT_MS) });
}
export function resendEmailRuntimeReady(runtime, fetchImpl = globalThis.fetch) {
  return Boolean(runtime?.apiKey && EMAIL_PATTERN.test(runtime?.from ?? '') && typeof fetchImpl === 'function');
}
export async function sendResendEmail(fetchImpl, runtime, { to, subject, text: textBody, html, operation, entityId }) {
  if (!resendEmailRuntimeReady(runtime, fetchImpl)) throw new Error('RESEND_EMAIL_UNAVAILABLE');
  if (!Array.isArray(to) || to.length === 0 || to.some((value) => !EMAIL_PATTERN.test(text(value)))) throw new Error('RESEND_EMAIL_RECIPIENT_INVALID');
  if (!text(operation) || !text(entityId)) throw new Error('RESEND_EMAIL_IDEMPOTENCY_CONTEXT_INVALID');
  const idempotencyKey = createIdempotencyKey(operation, entityId);
  const response = await fetchImpl(RESEND_EMAIL_ENDPOINT, {
    method: 'POST', signal: AbortSignal.timeout(runtime.timeoutMs),
    headers: { Authorization: `Bearer ${runtime.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: runtime.from, to, subject, text: textBody, html }),
  });
  const payload = await response.json().catch(() => null);
  if (!response?.ok || !payload?.id) throw new Error('RESEND_EMAIL_SEND_FAILED');
  return Object.freeze({ id: String(payload.id), idempotencyKey });
}
