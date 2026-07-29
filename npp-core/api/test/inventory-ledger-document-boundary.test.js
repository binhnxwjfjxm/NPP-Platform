import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeInventoryPost,
  inventoryDocumentBoundaryInternals,
} from '../src/services/inventory-ledger.js';

const requestContext = Object.freeze({ installationId: 'test-installation' });

test('generic inventory posting rejects browser-supplied historical snapshots', async () => {
  const result = await executeInventoryPost({
    adapter: null,
    requestContext,
    idempotencyKey: 'public-snapshot-rejected',
    payload: {
      movementType: 'OPENING_BALANCE',
      documentDate: '2026-07-29',
      lines: [{
        warehouseId: '00000000-0000-4000-8000-000000000001',
        sourceVariantId: '00000000-0000-4000-8000-000000000002',
        sourceQuantity: '1',
        sourceSku: 'FORGED-SKU',
      }],
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_DOCUMENT_POSTING_REQUIRED');
});

test('Supplier Return posting rebuilds the trusted snapshot from stored document rows', async () => {
  const client = {
    async query() {
      return {
        rows: [{
          status: 'approved',
          id: '00000000-0000-4000-8000-000000000011',
          source_warehouse_id: '00000000-0000-4000-8000-000000000012',
          location_id: '00000000-0000-4000-8000-000000000013',
          source_variant_id: '00000000-0000-4000-8000-000000000014',
          source_sku_snapshot: 'SKU-OLD',
          source_unit_id: '00000000-0000-4000-8000-000000000015',
          source_unit_code_snapshot: 'CT',
          return_quantity: '1.000000',
          conversion_to_base: '12.000000',
          base_variant_id: '00000000-0000-4000-8000-000000000016',
          base_sku_snapshot: 'SKU-BASE',
          lot_id: null,
          lot_code_snapshot: null,
          manufactured_date: null,
          expiry_date: null,
          supplier_lot_reference: null,
          source_goods_receipt_id: '00000000-0000-4000-8000-000000000017',
          source_goods_receipt_line_id: '00000000-0000-4000-8000-000000000018',
          source_purchase_order_line_id: '00000000-0000-4000-8000-000000000019',
          reason_code: 'DAMAGED',
          reason_note: 'Damaged carton',
          source_goods_receipt_number: 'GR-1',
          source_goods_receipt_line_number: 1,
        }],
      };
    },
  };

  const result = await inventoryDocumentBoundaryInternals.prepareInternalPostingPayload(
    client,
    requestContext,
    {
      movementType: 'SUPPLIER_RETURN_ISSUE',
      sourceDomain: 'PURCHASING',
      sourceDocumentType: 'SUPPLIER_RETURN',
      sourceDocumentId: '00000000-0000-4000-8000-000000000010',
      reasonCode: 'SUPPLIER_RETURN',
      lines: [{
        sourceQuantity: '999',
        sourceSku: 'FORGED',
        metadata: { supplierReturnLineId: '00000000-0000-4000-8000-000000000011' },
      }],
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.movementType, 'SUPPLIER_RETURN');
  assert.equal(result.value.reasonCode, 'SUPPLIER_RETURN_ISSUE');
  assert.equal(result.value.lines[0].sourceSku, 'SKU-OLD');
  assert.equal(result.value.lines[0].sourceQuantity, '1.000000');
  assert.equal(result.value.lines[0].conversionToBase, '12.000000');
  assert.equal(result.value.lines[0].direction, 'OUT');
});

test('Purchase Receipt posting uses the stored Goods Receipt conversion snapshot', async () => {
  const client = {
    async query() {
      return {
        rows: [{
          id: '00000000-0000-4000-8000-000000000021',
          warehouse_id: '00000000-0000-4000-8000-000000000022',
          location_id: '00000000-0000-4000-8000-000000000023',
          variant_id: '00000000-0000-4000-8000-000000000024',
          sku_snapshot: 'SKU-RECEIPT',
          unit_id: '00000000-0000-4000-8000-000000000025',
          unit_code_snapshot: 'BOX',
          accepted_quantity: '2.000000',
          conversion_to_base: '6.000000',
          base_variant_id: '00000000-0000-4000-8000-000000000026',
          base_sku: 'SKU-BASE',
          lot_id: null,
          lot_code_snapshot: null,
          manufactured_date: null,
          expiry_date: null,
          supplier_lot_reference: null,
          purchase_order_line_id: '00000000-0000-4000-8000-000000000027',
          line_number: 1,
        }],
      };
    },
  };

  const result = await inventoryDocumentBoundaryInternals.prepareInternalPostingPayload(
    client,
    requestContext,
    {
      movementType: 'PURCHASE_RECEIPT',
      sourceDomain: 'PURCHASING',
      sourceDocumentType: 'PURCHASE_RECEIPT',
      sourceDocumentId: '00000000-0000-4000-8000-000000000020',
      lines: [{
        sourceQuantity: '2',
        metadata: { goodsReceiptLineId: '00000000-0000-4000-8000-000000000021' },
      }],
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.lines[0].sourceSku, 'SKU-RECEIPT');
  assert.equal(result.value.lines[0].conversionToBase, '6.000000');
  assert.equal(result.value.lines[0].baseVariantId, '00000000-0000-4000-8000-000000000026');
});
