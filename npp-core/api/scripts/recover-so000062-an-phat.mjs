import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createIdempotencyKey } from '@npp/contracts';
import { buildSslConfig } from '../src/db/pool.js';
import * as salesOrderRepository from '../src/db/repositories/sales-order.js';
import { releasePreExecutionAllocations } from '../src/services/sales-fulfillment-allocation-release.js';
import { replaceSalesOrderFulfillmentDemand } from '../src/services/sales-fulfillment.js';

const TARGET = Object.freeze({
  orderId: 'd45487fa-a62f-4c66-ad10-0684150b51fe',
  orderNumber: 'SO-202609-000062',
  sourceVersion: 6,
  wrongVersion: 7,
  nextVersion: 8,
  sourceCustomerId: 'bda66749-80eb-4f21-b367-48c898647f7f',
  sourceCustomerCode: 'KH00060',
  sourceCustomerName: 'AN PHÁT',
  sourceTotal: '33232487',
  sourceLineCount: 25,
  sourceWeightKg: '807.78',
  sourceLineSignature: '779c67a77a16e91ef0267e6f59b94693',
  wrongCustomerId: 'f3fd8e47-6ce0-469b-8eb8-ac2be3ce2558',
  wrongCustomerName: 'KIM THIÊN HỘ',
  wrongTotal: '14269800',
  wrongLineCount: 21,
  wrongLineSignature: 'c04565855b27cd1c2faf9a9e417b5326',
  comparisonOrderId: '088f2b4e-f586-4885-905e-32c282b43bcd',
  comparisonOrderNumber: 'SO-202609-000107',
});

const ACTOR_ID = 'system:recovery-so000062-20260911';
const REQUEST_ID = 'recovery-so000062-v6-20260911';
const RECOVERY_REASON = 'Khôi phục dữ liệu đúng từ phiên bản 6 sau sự cố ghi chéo đơn ngày 11/09/2026';

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function normalizeNumeric(value) {
  const raw = String(value ?? '').trim();
  if (!raw.includes('.')) return raw.replace(/^\+/, '').replace(/^(-?)0+(?=\d)/, '$1');
  const [whole, fraction = ''] = raw.split('.');
  const compactFraction = fraction.replace(/0+$/, '');
  const compactWhole = whole.replace(/^\+/, '').replace(/^(-?)0+(?=\d)/, '$1') || '0';
  return compactFraction ? `${compactWhole}.${compactFraction}` : compactWhole;
}

function quotedIdentifier(value) {
  assert(/^[a-z_][a-z0-9_]*$/.test(value), `unsafe_identifier_${value}`);
  return `"${value}"`;
}

async function relationExists(client, name) {
  const result = await client.query('SELECT to_regclass($1) AS relation', [name]);
  return Boolean(result.rows[0]?.relation);
}

async function tableColumns(client, schema, table) {
  const result = await client.query(
    `SELECT column_name, is_generated, is_identity
       FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2
      ORDER BY ordinal_position`,
    [schema, table],
  );
  return result.rows
    .filter((column) => column.is_generated !== 'ALWAYS' && column.is_identity !== 'YES')
    .map((column) => column.column_name);
}

// Clone inside PostgreSQL with INSERT ... SELECT so json/jsonb/arrays/numerics never
// round-trip through JavaScript parameters. Overrides contain only scalar recovery fields.
async function cloneDatabaseRow(client, {
  schema,
  table,
  sourceWhere,
  sourceParams,
  overrides,
  failureCode,
}) {
  const columns = await tableColumns(client, schema, table);
  const params = [...sourceParams];
  const selectExpressions = columns.map((column) => {
    if (Object.prototype.hasOwnProperty.call(overrides, column)) {
      params.push(overrides[column]);
      return `$${params.length}`;
    }
    return `source.${quotedIdentifier(column)}`;
  });
  const names = columns.map(quotedIdentifier).join(', ');
  const result = await client.query(
    `INSERT INTO ${quotedIdentifier(schema)}.${quotedIdentifier(table)} (${names})
     SELECT ${selectExpressions.join(', ')}
       FROM ${quotedIdentifier(schema)}.${quotedIdentifier(table)} AS source
      WHERE ${sourceWhere}
      RETURNING id`,
    params,
  );
  assert(result.rowCount === 1, failureCode);
  return result.rows[0].id;
}

async function versionMetrics(client, installationId, orderId, versionNumber) {
  const result = await client.query(
    `SELECT v.id,
            v.version_number,
            v.version_status,
            v.customer_id,
            v.customer_code_snapshot,
            v.customer_name_snapshot,
            v.total::text AS total,
            count(l.id)::int AS line_count,
            COALESCE(sum(l.line_weight_kg),0)::text AS weight_kg,
            md5(COALESCE(string_agg(
              concat_ws('|', l.line_number::text, l.sku_snapshot,
                l.ordered_quantity::text, l.unit_code_snapshot,
                l.unit_price::text, l.line_total::text),
              '||' ORDER BY l.line_number
            ), '')) AS line_signature
       FROM sales.sales_order_versions v
       LEFT JOIN sales.sales_order_version_lines l
         ON l.installation_id=v.installation_id
        AND l.sales_order_version_id=v.id
      WHERE v.installation_id=$1
        AND v.sales_order_id=$2
        AND v.version_number=$3
      GROUP BY v.id`,
    [installationId, orderId, versionNumber],
  );
  return result.rows[0] ?? null;
}

async function currentOrderSignature(client, orderId) {
  const result = await client.query(
    `SELECT so.id,
            so.order_number,
            so.current_version_number,
            so.customer_id,
            cv.total::text AS total,
            count(l.id)::int AS line_count,
            md5(COALESCE(string_agg(
              concat_ws('|', l.line_number::text, l.sku_snapshot,
                l.ordered_quantity::text, l.unit_code_snapshot,
                l.unit_price::text, l.line_total::text),
              '||' ORDER BY l.line_number
            ), '')) AS line_signature
       FROM sales.sales_orders so
       JOIN sales.sales_order_versions cv
         ON cv.installation_id=so.installation_id
        AND cv.sales_order_id=so.id
        AND cv.version_number=so.current_version_number
       LEFT JOIN sales.sales_order_version_lines l
         ON l.installation_id=cv.installation_id
        AND l.sales_order_version_id=cv.id
      WHERE so.id=$1
      GROUP BY so.id, cv.id`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

async function cloneVersionSixAsEight(client, order, sourceRow, occurredAt) {
  const versionId = await cloneDatabaseRow(client, {
    schema: 'sales',
    table: 'sales_order_versions',
    sourceWhere: 'source.installation_id=$1 AND source.sales_order_id=$2 AND source.version_number=$3',
    sourceParams: [order.installation_id, TARGET.orderId, TARGET.sourceVersion],
    overrides: {
      id: randomUUID(),
      version_number: TARGET.nextVersion,
      version_status: 'draft',
      amendment_reason: RECOVERY_REASON,
      based_on_version_number: TARGET.wrongVersion,
      revision: 1,
      created_at: occurredAt,
      updated_at: occurredAt,
      created_by: ACTOR_ID,
      updated_by: ACTOR_ID,
      confirmed_at: null,
      confirmed_by: null,
    },
    failureCode: 'source_version_clone_failed',
  });

  const sourceLines = await client.query(
    `SELECT id
       FROM sales.sales_order_version_lines
      WHERE installation_id=$1 AND sales_order_version_id=$2
      ORDER BY line_number`,
    [order.installation_id, sourceRow.id],
  );
  assert(sourceLines.rowCount === TARGET.sourceLineCount, 'source_line_rows_changed');

  for (const sourceLine of sourceLines.rows) {
    await cloneDatabaseRow(client, {
      schema: 'sales',
      table: 'sales_order_version_lines',
      sourceWhere: 'source.installation_id=$1 AND source.id=$2',
      sourceParams: [order.installation_id, sourceLine.id],
      overrides: {
        id: randomUUID(),
        sales_order_version_id: versionId,
        revision: 1,
        created_at: occurredAt,
        updated_at: occurredAt,
        created_by: ACTOR_ID,
        updated_by: ACTOR_ID,
      },
      failureCode: `source_line_clone_failed_${sourceLine.id}`,
    });
  }
  return versionId;
}

async function run() {
  const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
  const sslMode = String(process.env.DATABASE_SSL_MODE ?? 'require').trim();
  assert(databaseUrl, 'missing_database_url');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: buildSslConfig(sslMode),
    max: 1,
  });
  const client = await pool.connect();
  let committed = false;

  try {
    await client.query('BEGIN');
    const occurredAt = new Date().toISOString();

    const orderResult = await client.query(
      `SELECT so.*, c.code AS current_customer_code, c.name AS current_customer_name
         FROM sales.sales_orders so
         JOIN shared.customers c
           ON c.installation_id=so.installation_id AND c.id=so.customer_id
        WHERE so.id=$1
        FOR UPDATE OF so`,
      [TARGET.orderId],
    );
    const order = orderResult.rows[0];
    assert(order, 'target_order_not_found');
    assert(order.order_number === TARGET.orderNumber, 'target_order_number_changed');
    assert(order.status === 'confirmed', 'target_order_status_changed');
    assert(Number(order.current_version_number) === TARGET.wrongVersion, 'target_current_version_changed');
    assert(order.customer_id === TARGET.wrongCustomerId, 'target_customer_no_longer_wrong_customer');
    assert(order.current_customer_name === TARGET.wrongCustomerName, 'target_wrong_customer_name_changed');

    const sourceMetric = await versionMetrics(client, order.installation_id, TARGET.orderId, TARGET.sourceVersion);
    const wrongMetric = await versionMetrics(client, order.installation_id, TARGET.orderId, TARGET.wrongVersion);
    assert(sourceMetric, 'source_version_not_found');
    assert(wrongMetric, 'wrong_version_not_found');
    assert(sourceMetric.version_status === 'superseded', 'source_version_status_changed');
    assert(sourceMetric.customer_id === TARGET.sourceCustomerId, 'source_customer_id_changed');
    assert(sourceMetric.customer_code_snapshot === TARGET.sourceCustomerCode, 'source_customer_code_changed');
    assert(sourceMetric.customer_name_snapshot === TARGET.sourceCustomerName, 'source_customer_name_changed');
    assert(normalizeNumeric(sourceMetric.total) === TARGET.sourceTotal, 'source_total_changed');
    assert(Number(sourceMetric.line_count) === TARGET.sourceLineCount, 'source_line_count_changed');
    assert(normalizeNumeric(sourceMetric.weight_kg) === TARGET.sourceWeightKg, 'source_weight_changed');
    assert(sourceMetric.line_signature === TARGET.sourceLineSignature, 'source_line_signature_changed');
    assert(wrongMetric.customer_id === TARGET.wrongCustomerId, 'wrong_version_customer_changed');
    assert(normalizeNumeric(wrongMetric.total) === TARGET.wrongTotal, 'wrong_version_total_changed');
    assert(Number(wrongMetric.line_count) === TARGET.wrongLineCount, 'wrong_version_line_count_changed');
    assert(wrongMetric.line_signature === TARGET.wrongLineSignature, 'wrong_version_line_signature_changed');

    const nextVersion = await client.query(
      `SELECT 1 FROM sales.sales_order_versions
        WHERE installation_id=$1 AND sales_order_id=$2 AND version_number=$3`,
      [order.installation_id, TARGET.orderId, TARGET.nextVersion],
    );
    assert(nextVersion.rowCount === 0, 'recovery_version_already_exists');

    const sourceResult = await client.query(
      `SELECT id, warehouse_id, sales_channel_id
         FROM sales.sales_order_versions
        WHERE installation_id=$1 AND sales_order_id=$2 AND version_number=$3`,
      [order.installation_id, TARGET.orderId, TARGET.sourceVersion],
    );
    const sourceRow = sourceResult.rows[0];
    assert(sourceRow, 'source_version_row_missing');

    const customerCheck = await client.query(
      `SELECT code, name FROM shared.customers
        WHERE installation_id=$1 AND id=$2`,
      [order.installation_id, TARGET.sourceCustomerId],
    );
    assert(customerCheck.rows[0]?.code === TARGET.sourceCustomerCode, 'source_customer_master_code_changed');
    assert(customerCheck.rows[0]?.name === TARGET.sourceCustomerName, 'source_customer_master_name_changed');

    if (await relationExists(client, 'accounting.receivable_documents')) {
      const receivable = await client.query(
        `SELECT count(*)::int AS count
           FROM accounting.receivable_documents
          WHERE installation_id=$1 AND sales_order_id=$2 AND status <> 'reversed'`,
        [order.installation_id, TARGET.orderId],
      );
      assert(Number(receivable.rows[0]?.count ?? 0) === 0, 'target_has_accounting_documents');
    }

    const otherBefore = await currentOrderSignature(client, TARGET.comparisonOrderId);
    assert(otherBefore, 'comparison_order_missing');
    assert(otherBefore.order_number === TARGET.comparisonOrderNumber, 'comparison_order_number_changed');
    assert(normalizeNumeric(otherBefore.total) === TARGET.wrongTotal, 'comparison_order_total_changed_before_recovery');
    assert(Number(otherBefore.line_count) === TARGET.wrongLineCount, 'comparison_order_line_count_changed_before_recovery');
    assert(otherBefore.line_signature === TARGET.wrongLineSignature, 'comparison_order_signature_changed_before_recovery');
    assert(otherBefore.line_signature === wrongMetric.line_signature, 'wrong_version_no_longer_matches_comparison_order');

    await cloneVersionSixAsEight(client, order, sourceRow, occurredAt);

    const draftMetric = await versionMetrics(client, order.installation_id, TARGET.orderId, TARGET.nextVersion);
    assert(draftMetric?.version_status === 'draft', 'recovery_draft_not_created');
    assert(draftMetric?.customer_id === TARGET.sourceCustomerId, 'recovery_draft_customer_not_an_phat');
    assert(normalizeNumeric(draftMetric?.total) === TARGET.sourceTotal, 'recovery_draft_total_not_restored');
    assert(Number(draftMetric?.line_count) === TARGET.sourceLineCount, 'recovery_draft_line_count_not_restored');
    assert(normalizeNumeric(draftMetric?.weight_kg) === TARGET.sourceWeightKg, 'recovery_draft_weight_not_restored');
    assert(draftMetric?.line_signature === TARGET.sourceLineSignature, 'recovery_draft_lines_not_exact_v6');

    const requestContext = Object.freeze({
      installationId: order.installation_id,
      actorId: ACTOR_ID,
      employeeId: null,
      sourceApp: 'production-recovery',
      requestId: REQUEST_ID,
      receivedAt: occurredAt,
      roles: Object.freeze(['owner']),
      permissions: Object.freeze([
        'core.sales-order.read-all',
        'core.sales-order.confirm',
        'core.fulfillment.read',
      ]),
      scopes: Object.freeze({
        branchIds: Object.freeze([]),
        warehouseIds: Object.freeze([sourceRow.warehouse_id]),
        territoryIds: Object.freeze([]),
      }),
    });

    const idempotencyKey = createIdempotencyKey('sales-order-recovery', TARGET.orderId);
    const released = await releasePreExecutionAllocations(client, {
      requestContext,
      salesOrderId: TARGET.orderId,
      idempotencyKey,
      intentName: 'manual-edit',
    });
    if (!released.ok) fail(`release_failed_${released.code}`);

    const confirmedId = await salesOrderRepository.confirmSalesOrderVersion(client, {
      installationId: order.installation_id,
      salesOrderId: TARGET.orderId,
      versionNumber: TARGET.nextVersion,
      previousVersionNumber: TARGET.wrongVersion,
      orderNumber: order.order_number,
      allocationId: order.order_number_allocation_id,
      actorId: ACTOR_ID,
    });
    assert(confirmedId === TARGET.orderId, 'confirm_recovery_version_failed');

    await client.query(
      `UPDATE sales.sales_orders
          SET sales_channel_id=$3
        WHERE installation_id=$1 AND id=$2`,
      [order.installation_id, TARGET.orderId, sourceRow.sales_channel_id],
    );

    const fulfillment = await replaceSalesOrderFulfillmentDemand(client, {
      requestContext,
      salesOrderId: TARGET.orderId,
      versionNumber: TARGET.nextVersion,
    });
    if (!fulfillment.ok) fail(`fulfillment_restore_failed_${fulfillment.code}`);

    const finalOrderResult = await client.query(
      `SELECT so.order_number, so.status, so.current_version_number,
              so.customer_id, c.code AS customer_code, c.name AS customer_name,
              so.fulfillment_status
         FROM sales.sales_orders so
         JOIN shared.customers c
           ON c.installation_id=so.installation_id AND c.id=so.customer_id
        WHERE so.installation_id=$1 AND so.id=$2`,
      [order.installation_id, TARGET.orderId],
    );
    const finalOrder = finalOrderResult.rows[0];
    const finalMetric = await versionMetrics(client, order.installation_id, TARGET.orderId, TARGET.nextVersion);

    assert(finalOrder?.order_number === TARGET.orderNumber, 'final_order_number_changed');
    assert(finalOrder?.status === 'confirmed', 'final_order_not_confirmed');
    assert(Number(finalOrder?.current_version_number) === TARGET.nextVersion, 'final_current_version_not_recovery_version');
    assert(finalOrder?.customer_id === TARGET.sourceCustomerId, 'final_customer_not_an_phat');
    assert(finalOrder?.customer_code === TARGET.sourceCustomerCode, 'final_customer_code_not_an_phat');
    assert(finalOrder?.customer_name === TARGET.sourceCustomerName, 'final_customer_name_not_an_phat');
    assert(finalMetric?.version_status === 'confirmed', 'final_version_not_confirmed');
    assert(normalizeNumeric(finalMetric?.total) === TARGET.sourceTotal, 'final_total_not_restored');
    assert(Number(finalMetric?.line_count) === TARGET.sourceLineCount, 'final_line_count_not_restored');
    assert(normalizeNumeric(finalMetric?.weight_kg) === TARGET.sourceWeightKg, 'final_weight_not_restored');
    assert(finalMetric?.line_signature === TARGET.sourceLineSignature, 'final_lines_not_exact_copy_of_v6');

    const wrongAfter = await versionMetrics(client, order.installation_id, TARGET.orderId, TARGET.wrongVersion);
    assert(wrongAfter?.version_status === 'superseded', 'wrong_version_not_preserved_as_superseded');
    assert(wrongAfter?.line_signature === TARGET.wrongLineSignature, 'wrong_version_history_changed');

    const otherAfter = await currentOrderSignature(client, TARGET.comparisonOrderId);
    assert(JSON.stringify(otherAfter) === JSON.stringify(otherBefore), 'comparison_order_changed_during_recovery');

    await client.query('COMMIT');
    committed = true;

    console.log(JSON.stringify(Object.freeze({
      restored: true,
      orderNumber: finalOrder.order_number,
      customer: finalOrder.customer_name,
      restoredFromVersion: TARGET.sourceVersion,
      currentVersion: TARGET.nextVersion,
      total: normalizeNumeric(finalMetric.total),
      lineCount: Number(finalMetric.line_count),
      weightKg: normalizeNumeric(finalMetric.weight_kg),
      fulfillmentStatus: finalOrder.fulfillment_status,
      preservedWrongVersion: TARGET.wrongVersion,
      comparisonOrderUnchanged: true,
      releasedAllocationCount: Array.isArray(released.released) ? released.released.length : 0,
    })));
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => {});
    const message = String(error?.message ?? error)
      .replace(/(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
      .slice(0, 300);
    console.error(JSON.stringify({ restored: false, error: message }));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await run();
