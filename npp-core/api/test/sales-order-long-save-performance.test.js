import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSalesOrderAppliedPrice } from '../src/services/sales-order-applied-price.js';
import { applyCommercialSnapshot } from '../src/db/repositories/sales-order-commercial.js';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const VARIANT_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const UNIT_ID = '44444444-4444-4444-8444-444444444444';
const CHANNEL_ID = '55555555-5555-4555-8555-555555555555';
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666';
const GROUP_ID = '77777777-7777-4777-8777-777777777777';
const BASE_LIST_ID = '88888888-8888-4888-8888-888888888888';
const BASE_ITEM_ID = '99999999-9999-4999-8999-999999999999';
const RULE_LIST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RULE_ITEM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SALES_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VERSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('giá chuẩn khi lưu đơn chỉ cần một lượt DB cho mỗi dòng', async () => {
  let queryCount = 0;
  const client = {
    async query(sql) {
      queryCount += 1;
      assert.match(sql, /price_list_items/);
      return {
        rows: [{
          variant: {
            id: VARIANT_ID,
            product_id: PRODUCT_ID,
            sku: 'SKU-01',
            name: 'SKU 01',
            is_active: true,
            is_sellable: true,
            unit_id: UNIT_ID,
            conversion_to_base: '1',
            product_code: 'SP-01',
            product_name: 'Sản phẩm 01',
          },
          channel: { id: CHANNEL_ID, is_active: true },
          customer: { id: CUSTOMER_ID, group_id: GROUP_ID, is_active: true },
          customer_group: null,
          candidates: [
            {
              item_id: RULE_ITEM_ID,
              adjustment_type: 'PERCENT_DISCOUNT',
              amount_minor: null,
              rate_bps: '1000',
              source_kind: 'ADMIN',
              source_key: null,
              external_rule_code: null,
              price_list_id: RULE_LIST_ID,
              price_list_code: 'DAI_LY',
              list_type: 'CHANNEL',
              priority: 200,
              stacking_mode: 'EXCLUSIVE',
              stop_processing: false,
            },
            {
              item_id: BASE_ITEM_ID,
              adjustment_type: 'FIXED_PRICE',
              amount_minor: '1000',
              rate_bps: null,
              source_kind: 'ADMIN',
              source_key: null,
              external_rule_code: null,
              price_list_id: BASE_LIST_ID,
              price_list_code: 'GIA_NEN',
              list_type: 'BASE',
              priority: 100,
              stacking_mode: 'EXCLUSIVE',
              stop_processing: false,
            },
          ],
        }],
      };
    },
  };

  const result = await resolveSalesOrderAppliedPrice(client, {
    installationId: INSTALLATION_ID,
    payload: {
      variantId: VARIANT_ID,
      quantity: '2',
      currencyCode: 'VND',
      priceAt: '2026-09-11T00:00:00.000Z',
      channelId: CHANNEL_ID,
      customerId: CUSTOMER_ID,
      priceSelectionMode: 'STANDARD',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolution.baseUnitPriceMinor, '1000');
  assert.equal(result.resolution.systemUnitPriceMinor, '900');
  assert.equal(result.resolution.finalUnitPriceMinor, '900');
  assert.equal(result.resolution.lineTotalMinor, '1800');
  assert.match(result.resolution.resolutionFingerprint, /^pricing-v1-[0-9a-f]{8}$/);
  assert.equal(queryCount, 1);
});

test('50 dòng thương mại được ghi snapshot trong một câu lệnh thay vì 50 lượt', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('SET sales_channel_id = $4')) {
        return { rowCount: 1, rows: [{ id: VERSION_ID }] };
      }
      if (sql.includes('SET customer_address_snapshot')) {
        return { rowCount: 1, rows: [{ id: VERSION_ID }] };
      }
      if (sql.includes('jsonb_to_recordset')) {
        return { rowCount: 50, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const lines = Array.from({ length: 50 }, (_, index) => ({
    lineNumber: index + 1,
    baseUnitPriceMinor: '1000',
    systemUnitPriceMinor: '900',
    finalUnitPriceMinor: '900',
    fingerprint: `pricing-v1-${String(index + 1).padStart(8, '0')}`,
    priceSource: 'PRICE_ENGINE',
    manualOverride: false,
    manualReason: null,
    systemTrace: [{
      kind: 'BASE',
      priceListId: BASE_LIST_ID,
      itemId: BASE_ITEM_ID,
      afterUnitPriceMinor: '1000',
    }],
  }));

  const applied = await applyCommercialSnapshot(client, {
    installationId: INSTALLATION_ID,
    salesOrderId: SALES_ORDER_ID,
    versionNumber: 1,
    channel: { id: CHANNEL_ID, code: 'DAI_LY', name: 'Đại lý' },
    priceSelectionMode: 'STANDARD',
    documentDiscount: { mode: 'NONE', value: '0', reason: null },
    lines,
  });

  assert.equal(applied, true);
  assert.equal(calls.length, 4);
  const batchCall = calls.find((call) => call.sql.includes('jsonb_to_recordset'));
  assert.ok(batchCall);
  assert.equal(JSON.parse(batchCall.params[2]).length, 50);
});
