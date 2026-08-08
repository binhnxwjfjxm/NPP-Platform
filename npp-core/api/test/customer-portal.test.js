import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCustomerPortalAuthenticator } from '../src/customer-portal-auth.js';
import { CUSTOMER_PORTAL_SOURCE_PREFIX, createPortalRequestContext } from '../src/services/customer-portal.js';

function b64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

function jwt(privateKey, kid, payload) {
  const header = b64url({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64url(payload);
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
  return `${header}.${body}.${signature}`;
}

function jwkFor(publicKey, kid) {
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return jwk;
}

function authEnv(overrides = {}) {
  return {
    CUSTOMER_PORTAL_ENABLED: 'true',
    CUSTOMER_PORTAL_CLERK_ISSUER: 'https://clerk.example.test',
    CUSTOMER_PORTAL_CLERK_JWKS_URL: 'https://clerk.example.test/.well-known/jwks.json',
    CUSTOMER_PORTAL_CLERK_AUTHORIZED_PARTIES: 'https://sales.example.test',
    ...overrides,
  };
}

test('customer portal verifies Clerk RS256 token and rejects wrong issuer', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'portal-test-key';
  const now = Date.parse('2026-08-08T04:00:00Z');
  const env = authEnv();
  const auth = createCustomerPortalAuthenticator({
    env,
    now: () => now,
    fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [jwkFor(publicKey, kid)] }) }),
  });
  const good = jwt(privateKey, kid, {
    iss: env.CUSTOMER_PORTAL_CLERK_ISSUER,
    sub: 'user_customer_123',
    azp: 'https://sales.example.test',
    exp: Math.floor(now / 1000) + 300,
  });
  const result = await auth.authenticate({ headers: { authorization: `Bearer ${good}` } });
  assert.equal(result.ok, true);
  assert.equal(result.subject, 'user_customer_123');

  const wrongIssuer = jwt(privateKey, kid, {
    iss: 'https://wrong.example.test',
    sub: 'user_customer_123',
    azp: 'https://sales.example.test',
    exp: Math.floor(now / 1000) + 300,
  });
  const rejected = await auth.authenticate({ headers: { authorization: `Bearer ${wrongIssuer}` } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'CUSTOMER_PORTAL_TOKEN_ISSUER_INVALID');
});

test('customer portal rejects bad signature, expired token and wrong authorized party', async () => {
  const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'portal-security-key';
  const now = Date.parse('2026-08-08T04:00:00Z');
  const env = authEnv();
  const auth = createCustomerPortalAuthenticator({
    env,
    now: () => now,
    fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [jwkFor(signing.publicKey, kid)] }) }),
  });
  const base = { iss: env.CUSTOMER_PORTAL_CLERK_ISSUER, sub: 'user_customer_123', azp: 'https://sales.example.test' };

  const badSignature = await auth.authenticate({ headers: { authorization: `Bearer ${jwt(other.privateKey, kid, { ...base, exp: Math.floor(now / 1000) + 300 })}` } });
  assert.equal(badSignature.ok, false);
  assert.equal(badSignature.code, 'CUSTOMER_PORTAL_TOKEN_SIGNATURE_INVALID');

  const expired = await auth.authenticate({ headers: { authorization: `Bearer ${jwt(signing.privateKey, kid, { ...base, exp: Math.floor(now / 1000) - 120 })}` } });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'CUSTOMER_PORTAL_TOKEN_EXPIRED');

  const wrongParty = await auth.authenticate({ headers: { authorization: `Bearer ${jwt(signing.privateKey, kid, { ...base, azp: 'https://other.example.test', exp: Math.floor(now / 1000) + 300 })}` } });
  assert.equal(wrongParty.ok, false);
  assert.equal(wrongParty.code, 'CUSTOMER_PORTAL_TOKEN_AUTHORIZED_PARTY_INVALID');
});

test('customer portal refreshes JWKS once when Clerk rotates to an unknown kid', async () => {
  const oldKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const newKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Date.parse('2026-08-08T04:00:00Z');
  const env = authEnv();
  let fetchCount = 0;
  const auth = createCustomerPortalAuthenticator({
    env,
    now: () => now,
    fetchImpl: async () => {
      fetchCount += 1;
      const keys = fetchCount === 1
        ? [jwkFor(oldKey.publicKey, 'old-kid')]
        : [jwkFor(newKey.publicKey, 'new-kid')];
      return { ok: true, json: async () => ({ keys }) };
    },
  });
  const token = jwt(newKey.privateKey, 'new-kid', {
    iss: env.CUSTOMER_PORTAL_CLERK_ISSUER,
    sub: 'user_customer_123',
    azp: 'https://sales.example.test',
    exp: Math.floor(now / 1000) + 300,
  });
  const result = await auth.authenticate({ headers: { authorization: `Bearer ${token}` } });
  assert.equal(result.ok, true);
  assert.equal(fetchCount, 2);
});

test('customer portal fails closed on missing verifier scope or JWKS outage', async () => {
  const missingScope = createCustomerPortalAuthenticator({
    env: authEnv({ CUSTOMER_PORTAL_CLERK_AUTHORIZED_PARTIES: '', CUSTOMER_PORTAL_CLERK_AUDIENCE: '' }),
  });
  assert.deepEqual(await missingScope.authenticate({ headers: {} }), { ok: false, code: 'CUSTOMER_PORTAL_AUTH_CONFIG_INVALID', statusCode: 503 });

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Date.parse('2026-08-08T04:00:00Z');
  const env = authEnv();
  const unavailable = createCustomerPortalAuthenticator({
    env,
    now: () => now,
    fetchImpl: async () => { throw new Error('network-down'); },
  });
  const token = jwt(privateKey, 'missing-kid', {
    iss: env.CUSTOMER_PORTAL_CLERK_ISSUER,
    sub: 'user_customer_123',
    azp: 'https://sales.example.test',
    exp: Math.floor(now / 1000) + 300,
  });
  const result = await unavailable.authenticate({ headers: { authorization: `Bearer ${token}` } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CUSTOMER_PORTAL_AUTH_UNAVAILABLE');
  assert.equal(result.statusCode, 503);
});

test('portal request context is least privilege and warehouse scoped from membership', () => {
  const membership = {
    portal_user_id: '11111111-1111-4111-8111-111111111111',
    default_warehouse_id: '22222222-2222-4222-8222-222222222222',
  };
  const createContext = ({ principal, requestId, receivedAt }) => ({ ...principal, requestId, receivedAt, installationId: 'npp-test' });
  const context = createPortalRequestContext(createContext, { installationId: 'npp-test' }, membership, { requestId: 'req-test', receivedAt: '2026-08-08T04:00:00Z' });
  assert.deepEqual(context.permissions, []);
  assert.deepEqual(context.scopes.warehouseIds, [membership.default_warehouse_id]);
  assert.equal(context.sourceApp, 'customer-ordering');
  assert.match(context.actorId, /^portal:/);
  assert.equal(CUSTOMER_PORTAL_SOURCE_PREFIX, 'CUSTOMER_PORTAL:');
});

test('migration owns identity and membership but not a second order table', () => {
  const sql = readFileSync(new URL('../../../database/migrations/sales/071_customer_portal_order_intake.sql', import.meta.url), 'utf8');
  assert.match(sql, /shared\.portal_users/);
  assert.match(sql, /shared\.portal_identities/);
  assert.match(sql, /sales\.customer_portal_memberships/);
  assert.match(sql, /default_warehouse_id/);
  assert.match(sql, /sales_channel_id/);
  assert.match(sql, /customer_portal_memberships_one_active_user_idx/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS sales\.customer_portal_orders/i);
});

test('portal service derives customer and warehouse server-side', () => {
  const source = readFileSync(new URL('../src/services/customer-portal.js', import.meta.url), 'utf8');
  assert.match(source, /customerId: membership\.customer_id/);
  assert.match(source, /warehouseId: membership\.default_warehouse_id/);
  assert.match(source, /salesChannelId: membership\.sales_channel_id/);
  assert.match(source, /sourceType: 'API'/);
  assert.match(source, /CUSTOMER_PORTAL:/);
  assert.doesNotMatch(source, /customerId:\s*payload\?\./);
});
