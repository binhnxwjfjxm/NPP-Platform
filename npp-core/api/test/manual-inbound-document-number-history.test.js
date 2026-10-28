import assert from 'node:assert/strict';
import test from 'node:test';
import { searchManualInboundHistory, readManualInboundHistoryDetail } from '../src/services/manual-inbound-history.js';
import { searchManualInboundDocuments } from '../src/db/repositories/manual-inbound-history.js';
import { getManualInboundConfirmationStatus } from '../src/services/manual-inbound.js';
const docId = '11111111-1111-4111-8111-111111111111';
const warehouseId = '22222222-2222-4222-8222-222222222222';
const scope = { installationId: 'test', permissions: ['core.inventory-manual-inbound.read'], scopes: { warehouseIds: [warehouseId] } };
test('history searches canonical number in the same restricted scope and uses stable cursor', async () => {
  let captured;
  const client = { async query(sql, params) {
    captured = { sql, params };
    return { rows: [{
      id: docId, inbound_type: 'MANUAL_RECEIPT', warehouse_code: 'YS-001',
      warehouse_name: 'Kho Yersin', document_date: '2026-10-22',
      reference_number: null, document_number: 'NKT-00000012',
      created_at: '2026-10-22T03:02:01Z', reversal_movement_id: null,
    }] };
  } };
  const res = await searchManualInboundHistory(client, {
    requestContext: scope, referenceNumber: 'NKT-00000012', limit: 21,
    beforeDocumentDate: '2026-10-22', beforeCreatedAt: '2026-10-22T03:02:01Z', beforeId: docId,
  });
  assert.equal(res.ok, true);
  assert.equal(res.documents[0].documentNumber, 'NKT-00000012');
  assert.equal(res.documents[0].referenceNumber, null);
  assert.match(captured.sql, /numbers\.document_number ILIKE/);
  assert.match(captured.sql, /document\.reference_number ILIKE/);
  assert.match(captured.sql, /document\.warehouse_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(captured.sql, /document\.document_date, document\.created_at, document\.id/);
  assert.deepEqual(captured.params, ['test', [warehouseId], null, 'NKT-00000012', 21, 0, '2026-10-22', '2026-10-22T03:02:01Z', docId]);
});
test('incomplete cursor or missing warehouse permission does not query database', async () => {
  const client = { async query() { throw Error('must not query'); } };
  const invalid = await searchManualInboundHistory(client, { requestContext: scope, beforeId: docId });
  assert.equal(invalid.code, 'INVALID_CURSOR');
  const denied = await searchManualInboundHistory(client, { requestContext: { ...scope, scopes: { warehouseIds: [] } } });
  assert.equal(denied.code, 'WAREHOUSE_SCOPE_DENIED');
});
test('detail returns the same canonical number', async () => {
  const client = { async query(sql, params) {
    assert.match(sql, /numbers\.document_number/);
    assert.deepEqual(params, ['test', [warehouseId], docId]);
    return { rows: [{ document_id: docId, document_date: '2026-10-22',
      reference_number: null, document_number: 'NKT-00000012', warehouse_code: 'YS-001',
      warehouse_name: 'Kho Yersin', base_variant_id: docId,
      sku: 'TEST', product_name: 'Test', base_unit_code: 'HOP',
      quantity_before: '2', quantity_delta: '4', quantity_after: '6' }] };
  } };
  const res = await readManualInboundHistoryDetail(client, { requestContext: scope, documentId: docId });
  assert.equal(res.detail.documentNumber, 'NKT-00000012');
});
test('export pagination offset compatibility remains intact', async () => {
  let params;
  await searchManualInboundDocuments({ async query(_sql, p) { params = p; return { rows: [] }; } }, {
    installationId: 'test', warehouseIds: [warehouseId], limit: 200, offset: 400,
  });
  assert.deepEqual(params.slice(4), [200, 400, null, null, null]);
});

test('confirmation status reads only the canonical document by the same key and installation', async () => {
  const postScope = { ...scope, permissions: ['core.inventory-manual-inbound.post'] };
  const queried = [];
  const client = { async query(sql, params) {
    assert.match(sql, /FROM inventory\.manual_inbound_documents document/);
    assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE/i);
    queried.push(params);
    return { rows: [{ id: params[1], warehouse_id: warehouseId, document_number: 'NKT-00000203' }] };
  } };
  const one = await getManualInboundConfirmationStatus(client, { requestContext: postScope, idempotencyKey: 'manual-inbound-confirm-123' });
  const again = await getManualInboundConfirmationStatus(client, { requestContext: postScope, idempotencyKey: 'manual-inbound-confirm-123' });
  assert.equal(one.ok, true);
  assert.equal(one.posted, true);
  assert.equal(one.document.documentNumber, 'NKT-00000203');
  assert.deepEqual(queried[0], queried[1]);
  assert.equal(queried[0][0], 'test');
  assert.match(queried[0][1], /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

test('confirmation status does not misreport an absent or out-of-scope document', async () => {
  const postScope = { ...scope, permissions: ['core.inventory-manual-inbound.post'] };
  const missing = await getManualInboundConfirmationStatus({ async query() { return { rows: [] }; } }, {
    requestContext: postScope, idempotencyKey: 'manual-inbound-confirm-404',
  });
  assert.equal(missing.ok, true);
  assert.equal(missing.posted, false);
  assert.equal(missing.document, null);
  const denied = await getManualInboundConfirmationStatus({ async query(_sql, params) {
    return { rows: [{ id: params[1], warehouse_id: '33333333-3333-4333-8333-333333333333' }] };
  } }, { requestContext: postScope, idempotencyKey: 'manual-inbound-confirm-denied' });
  assert.equal(denied.code, 'WAREHOUSE_SCOPE_DENIED');
  const noQuery = { async query() { throw new Error('must not query'); } };
  assert.equal((await getManualInboundConfirmationStatus(noQuery, {
    requestContext: { ...postScope, permissions: [] }, idempotencyKey: 'manual-inbound-confirm-1',
  })).code, 'PERMISSION_DENIED');
  assert.equal((await getManualInboundConfirmationStatus(noQuery, {
    requestContext: postScope, idempotencyKey: 'invalid key with spaces',
  })).code, 'INVALID_IDEMPOTENCY_KEY');
});
