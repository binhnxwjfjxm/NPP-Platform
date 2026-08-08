import { randomUUID } from 'node:crypto';
import { createRequestId } from '@npp/shared-utils';
import { loadConfig } from '../src/config.js';
import { createPgPool } from '../src/db/pool.js';
import { withAuditOutboxTransaction } from '../src/audit-outbox.js';

const PROVIDER = 'CLERK';
const COLLECTION_POLICY = 'COLLECT_ON_DELIVERY';
const ACTOR_ID = 'ops:phase-9-8-customer-portal-provisioning';
const SOURCE_APP = 'phase-9-8-customer-portal-provisioning';
const SUBJECT_PATTERN = /^user_[A-Za-z0-9]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;

function operationalError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.safeDetails = details;
  return error;
}

function normalizeOptionalCode(value, field) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) return '';
  if (!CODE_PATTERN.test(normalized)) throw operationalError(`invalid_${field}`);
  return normalized;
}

function shareClause(forShare) {
  return forShare ? '\n      FOR SHARE' : '';
}

export function validateProvisioningPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw operationalError('invalid_provisioning_payload');
  }
  const providerSubject = String(value.providerSubject ?? '').trim();
  const customerEmail = String(value.customerEmail ?? '').trim().toLowerCase();
  if (!SUBJECT_PATTERN.test(providerSubject)) throw operationalError('invalid_clerk_subject');
  if (!EMAIL_PATTERN.test(customerEmail) || customerEmail.length > 320) {
    throw operationalError('invalid_customer_email');
  }
  return Object.freeze({
    providerSubject,
    customerEmail,
    warehouseCode: normalizeOptionalCode(value.warehouseCode, 'warehouse_code'),
    salesChannelCode: normalizeOptionalCode(value.salesChannelCode, 'sales_channel_code'),
  });
}

export function chooseWarehouse(rows, requestedCode = '') {
  const active = Array.isArray(rows) ? rows : [];
  if (requestedCode) {
    const matches = active.filter((row) => row.code === requestedCode);
    if (matches.length !== 1) {
      throw operationalError('warehouse_code_not_resolved', {
        requestedCode,
        activeCodes: active.map((row) => row.code).slice(0, 20),
      });
    }
    return matches[0];
  }
  if (active.length !== 1) {
    throw operationalError('warehouse_selection_ambiguous', {
      activeCount: active.length,
      activeCodes: active.map((row) => row.code).slice(0, 20),
    });
  }
  return active[0];
}

export function chooseSalesChannel(rows, requestedCode = '') {
  const active = Array.isArray(rows) ? rows : [];
  if (requestedCode) {
    const matches = active.filter((row) => row.code === requestedCode);
    if (matches.length !== 1) {
      throw operationalError('sales_channel_code_not_resolved', {
        requestedCode,
        activeCodes: active.map((row) => row.code).slice(0, 20),
      });
    }
    return matches[0];
  }
  if (active.length === 1) return active[0];
  const portalChannels = active.filter((row) => row.code === 'CUSTOMER_PORTAL');
  if (portalChannels.length === 1) return portalChannels[0];
  throw operationalError('sales_channel_selection_ambiguous', {
    activeCount: active.length,
    activeCodes: active.map((row) => row.code).slice(0, 20),
  });
}

async function readPayloadFromStdin() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) throw operationalError('missing_provisioning_payload');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw operationalError('invalid_provisioning_json');
  }
  return validateProvisioningPayload(parsed);
}

async function resolveCustomer(client, installationId, customerEmail, { forShare = false } = {}) {
  const rows = (await client.query(
    `SELECT id, code, name
       FROM shared.customers
      WHERE installation_id = $1
        AND is_active = true
        AND lower(btrim(COALESCE(email, ''))) = lower(btrim($2))
      ORDER BY code ASC
      LIMIT 3${shareClause(forShare)}`,
    [installationId, customerEmail],
  )).rows;
  if (rows.length !== 1) {
    throw operationalError('customer_email_resolution_failed', { matchCount: rows.length });
  }
  return rows[0];
}

async function resolveWarehouse(client, installationId, requestedCode, { forShare = false } = {}) {
  const params = [installationId];
  let query = `SELECT id, code, name
                 FROM shared.warehouses
                WHERE installation_id = $1
                  AND is_active = true`;
  if (requestedCode) {
    query += ` AND code = $2 LIMIT 2${shareClause(forShare)}`;
    params.push(requestedCode);
  } else {
    query += ` ORDER BY code ASC LIMIT 21${shareClause(forShare)}`;
  }
  const rows = (await client.query(query, params)).rows;
  return chooseWarehouse(rows, requestedCode);
}

async function resolveSalesChannel(client, installationId, requestedCode, { forShare = false } = {}) {
  if (requestedCode) {
    const rows = (await client.query(
      `SELECT id, code, name
         FROM shared.sales_channels
        WHERE installation_id = $1
          AND is_active = true
          AND code = $2
        LIMIT 2${shareClause(forShare)}`,
      [installationId, requestedCode],
    )).rows;
    return chooseSalesChannel(rows, requestedCode);
  }

  const portalRows = (await client.query(
    `SELECT id, code, name
       FROM shared.sales_channels
      WHERE installation_id = $1
        AND is_active = true
        AND code = 'CUSTOMER_PORTAL'
      LIMIT 2${shareClause(forShare)}`,
    [installationId],
  )).rows;
  if (portalRows.length === 1) return portalRows[0];
  if (portalRows.length > 1) throw operationalError('sales_channel_selection_ambiguous');

  const activeRows = (await client.query(
    `SELECT id, code, name
       FROM shared.sales_channels
      WHERE installation_id = $1
        AND is_active = true
      ORDER BY code ASC
      LIMIT 21${shareClause(forShare)}`,
    [installationId],
  )).rows;
  return chooseSalesChannel(activeRows);
}

async function resolveTarget(client, installationId, input, { forShare = false } = {}) {
  const customer = await resolveCustomer(client, installationId, input.customerEmail, { forShare });
  const warehouse = await resolveWarehouse(client, installationId, input.warehouseCode, { forShare });
  const salesChannel = await resolveSalesChannel(client, installationId, input.salesChannelCode, { forShare });
  return Object.freeze({ customer, warehouse, salesChannel });
}

async function getExistingIdentity(client, installationId, providerSubject, { forUpdate = false } = {}) {
  const lockClause = forUpdate ? '\n      FOR UPDATE OF pi, pu' : '';
  return (await client.query(
    `SELECT pi.portal_user_id, pu.status AS portal_user_status
       FROM shared.portal_identities pi
       JOIN shared.portal_users pu
         ON pu.installation_id = pi.installation_id
        AND pu.id = pi.portal_user_id
      WHERE pi.installation_id = $1
        AND pi.provider = $2
        AND pi.provider_subject = $3${lockClause}`,
    [installationId, PROVIDER, providerSubject],
  )).rows[0] ?? null;
}

async function getActiveMembership(client, installationId, portalUserId) {
  const rows = (await client.query(
    `SELECT membership.id,
            membership.customer_id,
            membership.default_warehouse_id,
            membership.sales_channel_id,
            membership.collection_policy,
            membership.allow_cancel,
            customer.code AS customer_code,
            customer.is_active AS customer_active,
            warehouse.code AS warehouse_code,
            warehouse.is_active AS warehouse_active,
            channel.code AS sales_channel_code,
            channel.is_active AS sales_channel_active
       FROM sales.customer_portal_memberships membership
       JOIN shared.customers customer
         ON customer.installation_id = membership.installation_id
        AND customer.id = membership.customer_id
       JOIN shared.warehouses warehouse
         ON warehouse.installation_id = membership.installation_id
        AND warehouse.id = membership.default_warehouse_id
       JOIN shared.sales_channels channel
         ON channel.installation_id = membership.installation_id
        AND channel.id = membership.sales_channel_id
      WHERE membership.installation_id = $1
        AND membership.portal_user_id = $2
        AND membership.status = 'ACTIVE'
      ORDER BY membership.created_at ASC
      LIMIT 2`,
    [installationId, portalUserId],
  )).rows;
  if (rows.length > 1) throw operationalError('multiple_active_portal_memberships');
  return rows[0] ?? null;
}

function assertReplayMatches(existing, membership, target) {
  if (existing.portal_user_status !== 'ACTIVE') throw operationalError('portal_user_not_active');
  if (!membership) throw operationalError('existing_identity_without_active_membership');
  if (!membership.customer_active || !membership.warehouse_active || !membership.sales_channel_active) {
    throw operationalError('existing_membership_dependency_inactive');
  }
  if (
    membership.customer_id !== target.customer.id
    || membership.default_warehouse_id !== target.warehouse.id
    || membership.sales_channel_id !== target.salesChannel.id
    || membership.collection_policy !== COLLECTION_POLICY
    || membership.allow_cancel !== true
  ) {
    throw operationalError('existing_membership_mismatch', {
      customerCode: membership.customer_code,
      warehouseCode: membership.warehouse_code,
      salesChannelCode: membership.sales_channel_code,
      collectionPolicy: membership.collection_policy,
      allowCancel: membership.allow_cancel,
    });
  }
}

function sanitizedResult({ mode, target, portalUserId = null, membershipId = null, replayed = false }) {
  return Object.freeze({
    ok: true,
    mode,
    ready: true,
    replayed,
    portalUserId,
    membershipId,
    customerCode: target.customer.code,
    warehouseCode: target.warehouse.code,
    salesChannelCode: target.salesChannel.code,
    collectionPolicy: COLLECTION_POLICY,
    allowCancel: true,
  });
}

async function auditProvisioning(pool, installationId, input) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const target = await resolveTarget(client, installationId, input);
    const existing = await getExistingIdentity(client, installationId, input.providerSubject);
    if (!existing) {
      await client.query('ROLLBACK');
      return sanitizedResult({ mode: 'audit', target });
    }
    const membership = await getActiveMembership(client, installationId, existing.portal_user_id);
    assertReplayMatches(existing, membership, target);
    await client.query('ROLLBACK');
    return sanitizedResult({
      mode: 'audit',
      target,
      portalUserId: existing.portal_user_id,
      membershipId: membership.id,
      replayed: true,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function provision(pool, installationId, input) {
  const requestContext = Object.freeze({
    installationId,
    actorId: ACTOR_ID,
    employeeId: null,
    roles: Object.freeze(['bootstrap']),
    permissions: Object.freeze([]),
    scopes: Object.freeze({ branchIds: [], warehouseIds: [], territoryIds: [] }),
    requestId: createRequestId('req'),
    sourceApp: SOURCE_APP,
    receivedAt: new Date().toISOString(),
  });

  return withAuditOutboxTransaction({
    adapter: pool,
    mutate: async (client, { buildAuditRecord, insertAuditRecord }) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${installationId}:${PROVIDER}:${input.providerSubject}`],
      );
      const target = await resolveTarget(client, installationId, input, { forShare: true });
      const existing = await getExistingIdentity(
        client,
        installationId,
        input.providerSubject,
        { forUpdate: true },
      );
      if (existing) {
        const membership = await getActiveMembership(client, installationId, existing.portal_user_id);
        assertReplayMatches(existing, membership, target);
        return {
          ...sanitizedResult({
            mode: 'provision',
            target,
            portalUserId: existing.portal_user_id,
            membershipId: membership.id,
            replayed: true,
          }),
          replayed: true,
        };
      }

      const portalUserId = randomUUID();
      const identityId = randomUUID();
      const membershipId = randomUUID();
      const now = new Date().toISOString();

      await client.query(
        `INSERT INTO shared.portal_users
          (id, installation_id, status, display_name, created_at, updated_at, created_by, updated_by)
         VALUES ($1, $2, 'ACTIVE', $3, $4, $4, $5, $5)`,
        [portalUserId, installationId, target.customer.name, now, ACTOR_ID],
      );
      await client.query(
        `INSERT INTO shared.portal_identities
          (id, installation_id, portal_user_id, provider, provider_subject,
           created_at, updated_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $7)`,
        [identityId, installationId, portalUserId, PROVIDER, input.providerSubject, now, ACTOR_ID],
      );
      await client.query(
        `INSERT INTO sales.customer_portal_memberships
          (id, installation_id, portal_user_id, customer_id, default_warehouse_id,
           sales_channel_id, collection_policy, status, allow_cancel,
           created_at, updated_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', true, $8, $8, $9, $9)`,
        [
          membershipId,
          installationId,
          portalUserId,
          target.customer.id,
          target.warehouse.id,
          target.salesChannel.id,
          COLLECTION_POLICY,
          now,
          ACTOR_ID,
        ],
      );

      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action: 'customer_portal.membership.provision',
        resourceType: 'customer_portal_membership',
        resourceId: membershipId,
        afterData: {
          portalUserId,
          customerId: target.customer.id,
          defaultWarehouseId: target.warehouse.id,
          salesChannelId: target.salesChannel.id,
          collectionPolicy: COLLECTION_POLICY,
          allowCancel: true,
          provider: PROVIDER,
        },
        metadata: { phase: '9.8', provisioningMode: 'guarded-production' },
      }));

      return {
        ...sanitizedResult({ mode: 'provision', target, portalUserId, membershipId }),
        expectedAuditCount: 1,
        expectedOutboxCount: 0,
      };
    },
  });
}

export async function run(mode, payload, { config = loadConfig(), pool = null } = {}) {
  if (!['audit', 'provision'].includes(mode)) throw operationalError('invalid_provisioning_mode');
  const input = validateProvisioningPayload(payload);
  const adapter = pool ?? createPgPool(config);
  const ownsPool = !pool;
  try {
    return mode === 'audit'
      ? await auditProvisioning(adapter, config.installationId, input)
      : await provision(adapter, config.installationId, input);
  } finally {
    if (ownsPool) await adapter.end();
  }
}

async function main() {
  const mode = String(process.argv[2] ?? '').trim();
  try {
    const payload = await readPayloadFromStdin();
    const result = await run(mode, payload);
    console.log(`PHASE_9_8_PORTAL_RESULT=${JSON.stringify(result)}`);
  } catch (error) {
    const failure = {
      ok: false,
      mode,
      code: typeof error?.code === 'string' ? error.code : 'customer_portal_provisioning_failed',
      details: error?.safeDetails && typeof error.safeDetails === 'object' ? error.safeDetails : {},
    };
    console.log(`PHASE_9_8_PORTAL_RESULT=${JSON.stringify(failure)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('phase-9-8-provision-customer-portal.js')) {
  await main();
}
