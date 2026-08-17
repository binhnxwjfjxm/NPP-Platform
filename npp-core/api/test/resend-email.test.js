import assert from 'node:assert/strict';
import test from 'node:test';
import { loadResendEmailRuntime, resendEmailRuntimeReady, sendResendEmail } from '../src/email/resend.js';

const RECIPIENTS = ['khuongbinh.info@gmail.com', 'hgluckit@gmail.com', 'buomphuong@gmail.com'];

function testRuntime() {
  return loadResendEmailRuntime({
    env: {
      RESEND_API_KEY: 're_test_only',
      INTERNAL_AUTH_EMAIL_FROM: 'security@nguyenlieuhungphat.com',
      CLOUDFLARE_EMAIL_API_TOKEN: 'ignored',
    },
  });
}

test('Resend runtime reads RESEND_API_KEY only', () => {
  const runtime = testRuntime();
  assert.equal(runtime.apiKey, 're_test_only');
  assert.equal(resendEmailRuntimeReady(runtime, async () => ({ ok: true })), true);
});

test('Resend sends all requested test recipients and reuses one canonical key on retry', async () => {
  const runtime = testRuntime();
  const requests = [];
  const input = {
    to: RECIPIENTS,
    subject: 'Test OTP',
    text: 'Mã kiểm thử',
    html: '<p>Mã kiểm thử</p>',
    operation: 'login-challenge-email',
    entityId: '11111111-1111-4111-8111-111111111111',
  };
  const fetchImpl = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ id: 'email-123' }) };
  };

  await sendResendEmail(fetchImpl, runtime, input);
  await sendResendEmail(fetchImpl, runtime, input);

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body.to, RECIPIENTS);
  assert.deepEqual(requests[1].body.to, RECIPIENTS);
  assert.equal(requests[0].init.headers['Idempotency-Key'], requests[1].init.headers['Idempotency-Key']);
  assert.match(requests[0].init.headers['Idempotency-Key'], /^[A-Za-z0-9._-]{1,128}$/);
  assert.equal(requests[0].url, 'https://api.resend.com/emails');
  assert.equal(requests[0].body.from, 'security@nguyenlieuhungphat.com');
  assert.equal(JSON.stringify(requests[0].body).includes('re_test_only'), false);
});

test('Resend adapter fails closed when the provider rejects or returns no message id', async () => {
  const runtime = testRuntime();
  const input = {
    to: ['khuongbinh.info@gmail.com'],
    subject: 'Test',
    text: 'Test',
    html: '<p>Test</p>',
    operation: 'data-deletion-challenge-email',
    entityId: '22222222-2222-4222-8222-222222222222',
  };
  await assert.rejects(sendResendEmail(async () => ({ ok: false, json: async () => ({}) }), runtime, input), /RESEND_EMAIL_SEND_FAILED/);
  await assert.rejects(sendResendEmail(async () => ({ ok: true, json: async () => ({}) }), runtime, input), /RESEND_EMAIL_SEND_FAILED/);
});
