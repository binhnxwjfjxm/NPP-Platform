import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadInstallationOwnerScopes,
  loadUserAuthorization,
} from '../src/db/repositories/internal-workforce-auth.js';

function makeTrackedClient() {
  let inFlight = 0;
  let maxInFlight = 0;
  const calls = [];

  return {
    get maxInFlight() {
      return maxInFlight;
    },
    get calls() {
      return calls;
    },
    async query(sql) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push(sql);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      if (sql.includes('FROM shared.user_roles')) {
        return {
          rows: [{
            role_code: 'sales',
            web_login_challenge_required: false,
            permission_key: 'sales:read',
          }],
        };
      }
      if (sql.includes('FROM shared.user_scopes')) {
        return {
          rows: [{
            scope_type: 'BRANCH',
            scope_id: '11111111-1111-4111-8111-111111111111',
          }],
        };
      }
      if (sql.includes('FROM shared.security_owner_bindings')) return { rows: [] };
      if (sql.includes('FROM shared.branches')) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
      }
      if (sql.includes('FROM shared.warehouses')) {
        return { rows: [{ id: '22222222-2222-4222-8222-222222222222' }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test('authorization reads do not fan out one request across multiple pool connections', async () => {
  const client = makeTrackedClient();
  const result = await loadUserAuthorization(client, {
    installationId: '33333333-3333-4333-8333-333333333333',
    userId: '44444444-4444-4444-8444-444444444444',
  });

  assert.equal(client.calls.length, 3);
  assert.equal(client.maxInFlight, 1);
  assert.deepEqual(result.roles, ['sales']);
  assert.deepEqual(result.permissionKeys, ['sales:read']);
  assert.deepEqual(result.scopes.branchIds, ['11111111-1111-4111-8111-111111111111']);
});

test('owner scope reads stay sequential on the shared pool', async () => {
  const client = makeTrackedClient();
  const result = await loadInstallationOwnerScopes(client, {
    installationId: '33333333-3333-4333-8333-333333333333',
  });

  assert.equal(client.calls.length, 2);
  assert.equal(client.maxInFlight, 1);
  assert.deepEqual(result, {
    branchIds: ['11111111-1111-4111-8111-111111111111'],
    warehouseIds: ['22222222-2222-4222-8222-222222222222'],
  });
});
