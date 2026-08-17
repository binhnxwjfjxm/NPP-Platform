import assert from 'node:assert/strict';
import test from 'node:test';
import { loadResendEmailRuntime, resendEmailRuntimeReady, sendResendEmail } from '../src/email/resend.js';

const RECIPIENTS = ['khuongbinh.info@gmail.com', 'hgluckit@gmail.com', 'buomphuong@gmail.com'];

test('Resend runtime reads RESEND_API_KEY only', () => {
  const runtime = loadResendEmailRuntime({ env: { RESEND_API_KEY: 're_test_only', INTERNAL_AUTH_EMAIL_FROM: 'security@nguyenlieuhungphat.com', CLOUDFLARE_EMAIL_API_TOKEN: 'ignored' } });
  assert.equal(runtime.apiKey, 're_test_only');
  assert.equal(resendEmailRuntimeReady(runtime, async () => ({ ok: true })), true);
});

test('Resend sends all requested test recipients and reuses one canonical key for the same operation', async () => {
  const runtime = loadResendEmailRuntime({ env: { RESEND_API_KEY: 're_test_only', INTERNAL_AUTH_EMAIL_FROM: 'security@nguyenlieuhungphat.com' } });
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ id: 'email-123' }) }; };
  for (const recipient of RECIPIENTS) await sendResendEmail(fetchImpl, runtime, { to: [recipient], subject: 'Test OTP', text: 'Mã kiểm thử', html: '<p>Mã kiểm thử</p>', operation: 'login-challenge-email', entityId: '11111111-1111-4111-8111-111111111111' });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].init.headers['Idempotency-Key'], requests[1].init.headers['Idempotency-Key']);
  assert.equal(requests[1].init.headers['Idempotency-Key'], requests[2].init.headers['Idempotency-Key']);
  for (const request of requests) { assert.equal(request.url, 'https://api.resend.com/emails'); assert.match(request.init.headers['Idempotency-Key'], /^[A-Za-z0-9._-]{1,128}$/); assert.equal(request.body.from, 'security@nguyenlieuhungphat.com'); assert.equal(JSON.stringify(request.body).includes('re_test_only'), false); }
});

test('Resend adapter fails closed when the provider rejects or returns no message id', async () => {
  const runtime = loadResendEmailRuntime({ env: { RESEND_API_KEY: 're_test_only', INTERNAL_AUTH_EMAIL_FROM: 'security@nguyenlieuhungphat.com' } });
  const input = { to: ['khuongbinh.info@gmail.com'], subject: 'Test', text: 'Test', html: '<p>Test</p>', operation: 'data-deletion-challenge-email', entityId: '22222222-2222-4222-8222-222222222222' };
  await assert.rejects(sendResendEmail(async () => ({ ok: false, json: async () => ({}) }), runtime, input), /RESEND_EMAIL_SEND_FAILED/);
  await assert.rejects(sendResendEmail(async () => ({ ok: true, json: async () => ({}) }), runtime, input), /RESEND_EMAIL_SEND_FAILED/);
});
