import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listManualInboundSupplierOptions,
  manualInboundOperatorPreviewInternals,
} from '../src/services/manual-inbound-operator-preview.js';

const { addExactDecimal, normalizedSupplierId, enrichStock } = manualInboundOperatorPreviewInternals;

test('manual inbound stock preview cộng số tồn bằng decimal chính xác, kể cả tồn âm', () => {
  assert.equal(addExactDecimal('12.500000', '2.25'), '14.75');
  assert.equal(addExactDecimal('-3.5', '5.25'), '1.75');
  assert.equal(addExactDecimal('0', '0.000001'), '0.000001');
});

test('manual inbound supplier id là tùy chọn nhưng id đã chọn phải hợp lệ', () => {
  assert.equal(normalizedSupplierId(null), null);
  assert.equal(normalizedSupplierId(''), null);
  assert.equal(normalizedSupplierId('not-a-uuid'), false);
  assert.equal(normalizedSupplierId('11111111-1111-4111-8111-111111111111'), '11111111-1111-4111-8111-111111111111');
});

test('manual inbound stock preview dùng đúng scope kho/vị trí/lô và đơn vị tồn', () => {
  const common = enrichStock({
    baseVariantId: 'base-1',
    baseQuantity: '2.25',
    lotTrackingMode: 'NONE',
    locationId: null,
  }, { locationRequired: false }, [
    {
      base_variant_id: 'base-1',
      base_unit_code: 'KG',
      balance_base_variant_id: 'base-1',
      location_id: null,
      lot_id: null,
      on_hand_quantity: '12.5',
      normalized_lot_code: null,
    },
  ]);
  assert.equal(common.currentOnHand, '12.5');
  assert.equal(common.afterOnHand, '14.75');
  assert.equal(common.baseUnitCode, 'KG');

  const missingLocation = enrichStock({
    baseVariantId: 'base-1',
    baseQuantity: '1',
    lotTrackingMode: 'NONE',
    locationId: null,
  }, { locationRequired: true }, []);
  assert.equal(missingLocation.currentOnHand, null);
  assert.equal(missingLocation.afterOnHand, null);

  const newLot = enrichStock({
    baseVariantId: 'base-2',
    baseQuantity: '3',
    lotTrackingMode: 'REQUIRED',
    lotCode: 'LO-MOI',
    locationId: null,
  }, { locationRequired: false }, [
    {
      base_variant_id: 'base-2',
      base_unit_code: 'GOI',
      balance_base_variant_id: null,
      location_id: null,
      lot_id: null,
      on_hand_quantity: null,
      normalized_lot_code: null,
    },
  ]);
  assert.equal(newLot.currentOnHand, '0');
  assert.equal(newLot.afterOnHand, '3');
  assert.equal(newLot.baseUnitCode, 'GOI');
});

test('manual inbound lấy danh sách nhà cung cấp hoạt động bằng quyền chuẩn bị nhập kho', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 'supplier-1', code: 'NCC01', name: 'Nhà cung cấp 01' }] };
    },
  };
  const result = await listManualInboundSupplierOptions(client, {
    requestContext: {
      installationId: 'installation-1',
      permissions: ['core.inventory-manual-inbound.prepare'],
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.suppliers, [{ id: 'supplier-1', code: 'NCC01', name: 'Nhà cung cấp 01' }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM shared\.suppliers/);
  assert.deepEqual(calls[0].params, ['installation-1']);
});