import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseSalesChannel,
  chooseWarehouse,
  run,
  validateProvisioningPayload,
} from '../scripts/phase-9-8-provision-customer-portal.js';

const payload = Object.freeze({
  providerSubject: 'user_ABC123xyz',
  customerEmail: 'portal@example.com',
});

function createFakePool() {
  const state = {
    portalUser: null,
    identity: null,
    membership: null,
    auditCount: 0,
    insertCount: 0,
  };

  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).trim().replace(/\s+/g, ' ').toLowerCase();
      if (normalized === 'begin' || normalized === 'begin read only' || normalized === 'commit' || normalized === 'rollback') {
        return { rows: [] };
      }
      if (normalized.startsWith('select pg_advisory_xact_lock')) return { rows: [{ ok: true }] };
      if (normalized.includes('from shared.customers') && normalized.includes("lower(btrim(coalesce(email, '')))")) {
        return { rows: [{ id: '10000000-0000-4000-8000-000000000001', code: 'CUS001', name: 'Portal Customer' }] };
      }
      if (normalized.includes('from shared.warehouses') && normalized.includes('is_active = true')) {
        return { rows: [{ id: '20000000-0000-4000-8000-000000000001', code: 'WH01', name: 'Main Warehouse' }] };
      }
      if (normalized.includes('from shared.sales_channels') && normalized.includes('is_active = true')) {
        return { rows: [{ id: '30000000-0000-4000-8000-000000000001', code: 'CUSTOMER_PORTAL', name: 'Customer Portal' }] };
      }
      if (normalized.includes('from shared.portal_identities pi')) {
        if (!state.identity) return { rows: [] };
        return { rows: [{ portal_user_id: state.identity.portalUserId, portal_user_status: state.portalUser.status }] };
      }
      if (normalized.includes('from sales.customer_portal_memberships membership')) {
        if (!state.membership) return { rows: [] };
        return { rows: [{
          id: state.membership.id,
          customer_id: state.membership.customerId,
          default_warehouse_id: state.membership.warehouseId,
          sales_channel_id: state.membership.channelId,
          collection_policy: state.membership.collectionPolicy,
          allow_cancel: state.membership.allowCancel,
          customer_code: 'CUS001',
          customer_active: true,
          warehouse_code: 'WH01',
          warehouse_active: true,
          sales_channel_code: 'CUSTOMER_PORTAL',
          sales_channel_active: true,
        }] };
      }
      if (normalized.startsWith('insert into shared.portal_users')) {
        state.insertCount += 1;
        state.portalUser = { id: params[0], status: 'ACTIVE' };
        return { rows: [] };
      }
      if (normalized.startsWith('insert into shared.portal_identities')) {
        state.insertCount += 1;
        state.identity = { portalUserId: params[2], providerSubject: params[4] };
        return { rows: [] };
      }
      if (normalized.startsWith('insert into sales.customer_portal_memberships')) {
        state.insertCount += 1;
        state.membership = {
          id: params[0],
          customerId: params[3],
          warehouseId: params[4],
          channelId: params[5],
          collectionPolicy: params[6],
          allowCancel: true,
        };
        return { rows: [] };
      }
      if (normalized.startsWith('insert into shared.core_audit_records')) {
        state.auditCount += 1;
        return { rows: [] };
      }
      throw new Error(`unexpected_fake_query:${normalized}`);
    },
    release() {},
  };

  return {
    state,
    async connect() { return client; },
  };
}

test('payload validation normalizes optional codes and rejects malformed identity', () => {
  assert.deepEqual(
    validateProvisioningPayload({ ...payload, warehouseCode: 'wh01', salesChannelCode: 'customer_portal' }),
    {
      providerSubject: 'user_ABC123xyz',
      customerEmail: 'portal@example.com',
      warehouseCode: 'WH01',
      salesChannelCode: 'CUSTOMER_PORTAL',
    },
  );
  assert.throws(() => validateProvisioningPayload({ ...payload, providerSubject: 'not-a-clerk-user' }), /invalid_clerk_subject/);
  assert.throws(() => validateProvisioningPayload({ ...payload, customerEmail: 'bad-email' }), /invalid_customer_email/);
});

test('warehouse and sales-channel selection fail closed on ambiguity', () => {
  assert.equal(chooseWarehouse([{ code: 'WH01' }]).code, 'WH01');
  assert.throws(() => chooseWarehouse([{ code: 'WH01' }, { code: 'WH02' }]), /warehouse_selection_ambiguous/);
  assert.equal(
    chooseSalesChannel([{ code: 'DIRECT' }, { code: 'CUSTOMER_PORTAL' }]).code,
    'CUSTOMER_PORTAL',
  );
  assert.throws(
    () => chooseSalesChannel([{ code: 'DIRECT' }, { code: 'MCP' }]),
    /sales_channel_selection_ambiguous/,
  );
});

test('provisioning is transactional, audited and idempotent on replay', async () => {
  const pool = createFakePool();
  const config = { installationId: 'installation-test' };

  const first = await run('provision', payload, { config, pool });
  assert.equal(first.ok, true);
  assert.equal(first.replayed, false);
  assert.equal(first.customerCode, 'CUS001');
  assert.equal(first.warehouseCode, 'WH01');
  assert.equal(first.salesChannelCode, 'CUSTOMER_PORTAL');
  assert.equal(first.collectionPolicy, 'COLLECT_ON_DELIVERY');
  assert.equal(pool.state.insertCount, 3);
  assert.equal(pool.state.auditCount, 1);
  assert.equal('providerSubject' in first, false);
  assert.equal('customerEmail' in first, false);

  const second = await run('provision', payload, { config, pool });
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(pool.state.insertCount, 3, 'replay must not create additional portal records');
  assert.equal(pool.state.auditCount, 1, 'replay must remain read-only');
});
