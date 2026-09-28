import test from 'node:test';
import assert from 'node:assert/strict';
import { salesOrderAppliedPriceInternals } from '../src/services/sales-order-applied-price.js';
import { selectPricingStart } from '../src/services/pricing-start.js';

const VARIANT_ID = '11111111-1111-4111-8111-111111111111';
const CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const GROUP_ID = '55555555-5555-4555-8555-555555555555';

function row(overrides) {
  return {
    item_id: overrides.item_id,
    adjustment_type: 'FIXED_PRICE',
    amount_minor: '0',
    rate_bps: null,
    price_list_id: overrides.price_list_id,
    price_list_code: overrides.price_list_code,
    list_type: 'CHANNEL',
    priority: 200,
    stacking_mode: 'EXCLUSIVE',
    stop_processing: false,
    source_kind: 'ADMIN',
    source_key: null,
    external_rule_code: null,
    ...overrides,
  };
}

test('giá nền vẫn luôn là điểm bắt đầu khi đã tồn tại', () => {
  const base = row({ item_id: 'base', price_list_id: 'base-list', price_list_code: 'BASE', list_type: 'BASE', amount_minor: '100000', priority: 100 });
  const channel = row({ item_id: 'channel', price_list_id: 'channel-list', price_list_code: 'CHANNEL', amount_minor: '90000' });
  const start = selectPricingStart([channel, base]);
  assert.equal(start?.source, 'BASE');
  assert.equal(start?.candidate.item_id, 'base');
});

test('không dùng điều chỉnh phần trăm của kênh làm giá gốc khi thiếu giá nền', () => {
  const percentChannel = row({
    item_id: 'channel-percent',
    price_list_id: 'channel-list',
    price_list_code: 'CHANNEL',
    adjustment_type: 'PERCENT_DISCOUNT',
    amount_minor: null,
    rate_bps: '500',
  });
  assert.equal(selectPricingStart([percentChannel]), null);
});

test('đơn bán hàng dùng giá trực tiếp của kênh làm giá gốc khi thiếu giá nền', async () => {
  const candidates = [
    row({
      item_id: 'group',
      price_list_id: 'group-list',
      price_list_code: 'GROUP',
      list_type: 'CUSTOMER_GROUP',
      priority: 300,
      adjustment_type: 'PERCENT_DISCOUNT',
      amount_minor: null,
      rate_bps: '500',
    }),
    row({
      item_id: 'channel',
      price_list_id: 'channel-list',
      price_list_code: 'CHANNEL',
      list_type: 'CHANNEL',
      priority: 200,
      adjustment_type: 'FIXED_PRICE',
      amount_minor: '320000',
    }),
  ];
  const client = {
    async query() {
      return {
        rows: [{
          variant: {
            id: VARIANT_ID,
            product_id: 'product-1',
            sku: 'DAOWINT',
            name: 'DAOWINT',
            is_active: true,
            is_sellable: true,
            unit_id: 'unit-1',
            conversion_to_base: '1',
          },
          channel: { id: CHANNEL_ID, is_active: true },
          customer: null,
          customer_group: { id: GROUP_ID, is_active: true },
          candidates,
        }],
      };
    },
  };

  const result = await salesOrderAppliedPriceInternals.resolveStandardAppliedPrice(client, {
    installationId: 'installation-test',
    payload: {
      variantId: VARIANT_ID,
      quantity: '1',
      channelId: CHANNEL_ID,
      customerGroupId: GROUP_ID,
      currencyCode: 'VND',
      priceAt: '2026-09-28T03:00:00.000Z',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolution.baseUnitPriceMinor, '320000');
  assert.equal(result.resolution.finalUnitPriceMinor, '304000');
  assert.equal(result.resolution.steps[0].reason, 'CHANNEL_FIXED_FALLBACK');
});
