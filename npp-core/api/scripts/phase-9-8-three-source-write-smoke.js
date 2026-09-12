import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIdempotencyKey } from '../../../packages/contracts/index.js';
import { loadConfig } from '../src/config.js';
import { createPgPool } from '../src/db/pool.js';
import { createMcpSalesPrincipal } from '../src/request-context-base.js';
import * as salesOrderSearchPreviewService from '../src/services/sales-order-search-preview.js';
import * as salesOrderService from '../src/services/sales-order.js';
import * as portalService from '../src/services/customer-portal.js';

const ACTOR_ID = 'ops:phase-9-8-three-source-write-smoke';
const SOURCE_APP = 'phase-9-8-three-source-write-smoke';
const MAX_FIXTURES = 20;
const CANDIDATE_LIMIT = 50;
const MAX_FAILURE_CODES = 20;

function operationalError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.safeDetails = details;
  return error;
}

function requestContext(config, warehouseId) {
  return Object.freeze({
    installationId: config.installationId,
    actorId: ACTOR_ID,
    employeeId: null,
    roles: Object.freeze(['phase-9-8-smoke']),
    permissions: Object.freeze([]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([warehouseId]),
      territoryIds: Object.freeze([]),
    }),
    requestId: `phase98-${randomUUID()}`,
    sourceApp: SOURCE_APP,
    receivedAt: new Date().toISOString(),
  });
}

function mcpRequestContext(config, employeeId) {
  const principal = createMcpSalesPrincipal(config, employeeId);
  if (!principal) throw operationalError('mcp_sales_principal_unavailable');
  return Object.freeze({
    ...principal,
    installationId: config.installationId,
    requestId: `phase98-mcp-${randomUUID()}`,
    receivedAt: new Date().toISOString(),
  });
}

async function loadFixtures(client, config) {
  const warehouseIds = Array.isArray(config.mcpSalesWarehouseIds)
    ? config.mcpSalesWarehouseIds.filter(Boolean)
    : [];
  if (warehouseIds.length === 0) throw operationalError('mcp_sales_warehouse_scope_missing');
  const result = await client.query(
    `WITH warehouse AS (
       SELECT id
         FROM shared.warehouses
        WHERE installation_id = $1
          AND is_active = true
          AND id = ANY($2::uuid[])
        ORDER BY code ASC
        LIMIT 1
     ), sales_channel AS (
       SELECT id
         FROM shared.sales_channels
        WHERE installation_id = $1
          AND is_active = true
        ORDER BY CASE WHEN code = 'CUSTOMER_PORTAL' THEN 0 ELSE 1 END, code ASC
        LIMIT 1
     ), mcp_employee AS (
       SELECT id
         FROM shared.employees
        WHERE installation_id = $1
          AND is_active = true
        ORDER BY updated_at DESC NULLS LAST, id ASC
        LIMIT 1
     )
     SELECT c.id AS customer_id,
            address.id AS address_id,
            warehouse.id AS warehouse_id,
            sales_channel.id AS sales_channel_id,
            mcp_employee.id AS mcp_employee_id
       FROM shared.customers c
       JOIN shared.customer_addresses address
         ON address.installation_id = c.installation_id
        AND address.customer_id = c.id
        AND address.is_active = true
       CROSS JOIN warehouse
       CROSS JOIN sales_channel
       CROSS JOIN mcp_employee
      WHERE c.installation_id = $1
        AND c.is_active = true
      ORDER BY c.updated_at DESC, address.is_default DESC, address.updated_at DESC
      LIMIT $3`,
    [config.installationId, warehouseIds, MAX_FIXTURES],
  );
  return result.rows;
}

function commonPayload(fixture, variantId, marker) {
  return {
    customerMode: 'EXISTING',
    customerId: fixture.customer_id,
    customerAddressId: fixture.address_id,
    warehouseId: fixture.warehouse_id,
    salesChannelId: fixture.sales_channel_id,
    deliveryMode: 'DELIVERY',
    collectionPolicy: 'COLLECT_ON_DELIVERY',
    currency: 'VND',
    requestedDeliveryDate: null,
    note: `Phase 9.8 rollback smoke ${marker}`,
    lines: [{ variantId, quantity: '1' }],
  };
}

function expectSuccess(result, code) {
  if (!result?.ok) throw operationalError(code, { serviceCode: result?.code ?? 'unknown' });
  return result;
}

function expectDuplicate(result, code) {
  if (result?.ok || result?.code !== 'SOURCE_REFERENCE_DUPLICATE') {
    throw operationalError(code, { serviceCode: result?.code ?? 'unexpected_success' });
  }
}

function recordCandidateFailure(failures, error) {
  if (failures.size >= MAX_FAILURE_CODES) return;
  const code = String(error?.code ?? 'candidate_failed');
  const serviceCode = error?.safeDetails?.serviceCode ? String(error.safeDetails.serviceCode) : '';
  failures.add(serviceCode ? `${code}:${serviceCode}` : code);
}

async function loadCanonicalCandidates(client, context, fixture, failures) {
  const result = await salesOrderSearchPreviewService.searchSalesOrderSkuOptions(client, {
    requestContext: context,
    search: '',
    warehouseId: fixture.warehouse_id,
    salesChannelId: fixture.sales_channel_id,
    customerId: fixture.customer_id,
    priceSelectionMode: 'STANDARD',
    pricingAt: context.receivedAt,
    limit: CANDIDATE_LIMIT,
    offset: 0,
  });
  if (!result?.ok) {
    failures.add(`candidate_search:${String(result?.code ?? 'unknown')}`);
    return [];
  }
  return result.skuOptions.filter((item) => (
    item?.eligibility?.selectable === true
    && item?.pricePreview?.status === 'RESOLVED'
    && item?.pricePreview?.unitPriceMinor !== null
  ));
}

async function exerciseFixture(client, config, fixture, failures) {
  const context = requestContext(config, fixture.warehouse_id);
  const mcpContext = mcpRequestContext(config, fixture.mcp_employee_id);
  const syntheticMembership = Object.freeze({
    portal_user_id: randomUUID(),
    customer_id: fixture.customer_id,
    default_warehouse_id: fixture.warehouse_id,
    sales_channel_id: fixture.sales_channel_id,
    collection_policy: 'COLLECT_ON_DELIVERY',
    allow_cancel: true,
  });
  const candidates = await loadCanonicalCandidates(client, context, fixture, failures);

  for (const item of candidates) {
    const marker = randomUUID().replaceAll('-', '').slice(0, 20);
    const portalKey = createIdempotencyKey('phase-9-8-customer-portal-order');
    const mcpSourceId = `phase98-mcp-${marker}`;
    const mcpOutletId = `phase98-outlet-${marker}`;
    await client.query('SAVEPOINT phase98_candidate');
    try {
      const portalPayload = {
        addressId: fixture.address_id,
        lines: [{ sku: item.sku, quantity: 1 }],
        orderNote: `Phase 9.8 rollback smoke ${marker}`,
      };
      const portal = expectSuccess(await portalService.createPortalOrder(client, {
        requestContext: context,
        membership: syntheticMembership,
        idempotencyKey: portalKey,
        payload: portalPayload,
      }), 'customer_portal_write_failed');

      const internal = expectSuccess(await salesOrderService.createSalesOrder(client, {
        requestContext: context,
        payload: { ...commonPayload(fixture, item.id, marker), sourceType: 'MANUAL' },
      }), 'internal_write_failed');

      const mcpPayload = {
        ...commonPayload(fixture, item.id, marker),
        sourceType: 'MCP',
        sourceId: mcpSourceId,
        sourceOutletId: mcpOutletId,
      };
      const mcp = expectSuccess(await salesOrderService.createSalesOrder(client, {
        requestContext: mcpContext,
        payload: mcpPayload,
      }), 'mcp_write_failed');

      expectDuplicate(await salesOrderService.createSalesOrder(client, {
        requestContext: mcpContext,
        payload: mcpPayload,
      }), 'mcp_duplicate_guard_failed');

      expectDuplicate(await portalService.createPortalOrder(client, {
        requestContext: context,
        membership: syntheticMembership,
        idempotencyKey: portalKey,
        payload: portalPayload,
      }), 'customer_portal_duplicate_guard_failed');

      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      const ids = [internal.salesOrder.id, mcp.salesOrder.id, portal.order.id];
      const rows = (await client.query(
        `SELECT id, source_type, source_id, source_employee_id
           FROM sales.sales_orders
          WHERE installation_id = $1
            AND id = ANY($2::uuid[])`,
        [config.installationId, ids],
      )).rows;
      if (rows.length !== 3) throw operationalError('write_projection_count_mismatch', { count: rows.length });
      const byId = new Map(rows.map((row) => [row.id, row]));
      if (byId.get(internal.salesOrder.id)?.source_type !== 'MANUAL') throw operationalError('internal_lineage_mismatch');
      if (
        byId.get(mcp.salesOrder.id)?.source_type !== 'MCP'
        || byId.get(mcp.salesOrder.id)?.source_id !== mcpSourceId
        || byId.get(mcp.salesOrder.id)?.source_employee_id !== fixture.mcp_employee_id
      ) {
        throw operationalError('mcp_lineage_mismatch');
      }
      const portalRow = byId.get(portal.order.id);
      const portalPrefix = `CUSTOMER_PORTAL:${syntheticMembership.portal_user_id}:`;
      if (portalRow?.source_type !== 'API' || !String(portalRow.source_id ?? '').startsWith(portalPrefix)) {
        throw operationalError('customer_portal_lineage_mismatch');
      }
      return Object.freeze({ ids });
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT phase98_candidate');
      await client.query('RELEASE SAVEPOINT phase98_candidate');
      if (
        error?.code === 'write_projection_count_mismatch'
        || error?.code?.endsWith('_lineage_mismatch')
        || error?.code?.endsWith('_duplicate_guard_failed')
      ) throw error;
      recordCandidateFailure(failures, error);
    }
  }
  return null;
}

export async function run({ config = loadConfig(), pool = null } = {}) {
  const adapter = pool ?? createPgPool(config);
  const ownsPool = !pool;
  const client = await adapter.connect();
  let writtenIds = [];
  const candidateFailures = new Set();
  try {
    await client.query('BEGIN');
    const fixtures = await loadFixtures(client, config);
    if (fixtures.length === 0) throw operationalError('no_active_sales_fixture');
    let exercised = null;
    for (const fixture of fixtures) {
      exercised = await exerciseFixture(client, config, fixture, candidateFailures);
      if (exercised) break;
    }
    if (!exercised) {
      throw operationalError('no_orderable_rollback_fixture', {
        attemptedFixtures: fixtures.length,
        candidateFailures: [...candidateFailures],
      });
    }
    writtenIds = exercised.ids;
    await client.query('ROLLBACK');

    const persisted = Number((await client.query(
      `SELECT count(*)::int AS count
         FROM sales.sales_orders
        WHERE installation_id = $1
          AND id = ANY($2::uuid[])`,
      [config.installationId, writtenIds],
    )).rows[0]?.count ?? 0);
    if (persisted !== 0) throw operationalError('rollback_verification_failed', { persisted });

    return Object.freeze({
      ok: true,
      internalWriteRollback: true,
      mcpWriteRollback: true,
      customerPortalServiceWriteRollback: true,
      deferredConstraintsChecked: true,
      mcpSourceDuplicateGuard: true,
      customerPortalSourceDuplicateGuard: true,
      productionPersistedTestRows: 0,
      customerPortalHttpClerkWrite: 'not_exercised_no_test_session',
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    if (ownsPool) await adapter.end();
  }
}

async function main() {
  try {
    const result = await run();
    console.log(`PHASE_9_8_WRITE_SMOKE_RESULT=${JSON.stringify(result)}`);
  } catch (error) {
    console.log(`PHASE_9_8_WRITE_SMOKE_RESULT=${JSON.stringify({
      ok: false,
      code: error?.code ?? 'phase_9_8_write_smoke_failed',
      details: error?.safeDetails ?? {},
    })}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
