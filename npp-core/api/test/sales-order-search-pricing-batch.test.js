import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSalesOrderSearchPrices } from '../src/services/sales-order-search-pricing.js';

const VARIANT_A = '11111111-1111-4111-8111-111111111111';
const VARIANT_B = '22222222-2222-4222-8222-222222222222';
const VARIANT_C = '33333333-3333-4333-8333-333333333333';
const CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const CUSTOMER_GROUP_ID = '55555555-5555-4555-8555-555555555555';
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666';

function candidate(variantId, overrides) {
  return {
    variant_id: variantId,
    item_id: `${overrides.item_id}`,
    adjustment_type: 'FIXED_PRICE',
    amount_minor: '0',
    rate_bps: null,
    min_quantity: '0',
    max_quantity: null,
    source_kind: 'ADMIN',
    source_key: null,
    external_rule_code: null,
    price_list_id: `${overrides.price_list_id}`,
    price_list_code: overrides.price_list_code,
    price_list_name: overrides.price_list_code,
    list_type: 'BASE',
    priority: 100,
    stacking_mode: 'EXCLUSIVE',
    stop_processing: false,
    channel_id: null,
    customer_group_id: null,
    customer_id: null,
    ...overrides,
  };
}

test('sales order search batches preview pricing for all visible SKU rows in one query', async () => {
  const rows = [
    candidate(VARIANT_A, {
      item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      price_list_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1',
      price_list_code: 'CUS',
      list_type: 'CUSTOMER',
      priority: 500,
      adjustment_type: 'PERCENT_DISCOUNT',
      amount_minor: null,
      rate_bps: '1000',
      customer_id: CUSTOMER_ID,
    }),
    candidate(VARIANT_A, {
      item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      price_list_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab2',
      price_list_code: 'PROMO',
      list_type: 'PROMOTION',
      priority: 400,
      stacking_mode: 'STACKABLE',
      adjustment_type: 'AMOUNT_DISCOUNT',
      amount_minor: '5000',
    }),
    candidate(VARIANT_A, {
      item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      price_list_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab3',
      price_list_code: 'CHANNEL',
      list_type: 'CHANNEL',
      priority: 200,
      adjustment_type: 'FIXED_PRICE',
      amount_minor: '95000',
      channel_id: CHANNEL_ID,
    }),
    candidate(VARIANT_A, {
      item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      price_list_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab4',
      price_list_code: 'BASE',
      amount_minor: '100000',
    }),
    candidate(VARIANT_C, {
      item_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      price_list_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccb1',
      price_list_code: 'CUSTOM',
      list_type: 'CUSTOM',
      priority: 600,
      stacking_mode: 'STACKABLE',
      adjustment_type: 'AMOUNT_MARKUP',
      amount_minor: '10000',
    }),
    candidate(VARIANT_C, {
      item_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      price_list_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccb2',
      price_list_code: 'BASE',
      amount_minor: '70000',
    }),
  ];
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    },
  };

  const result = await resolveSalesOrderSearchPrices(client, {
    installationId: 'installation-test',
    variantIds: [VARIANT_A, VARIANT_B, VARIANT_C, VARIANT_A],
    priceAt: '2026-08-28T08:00:00.000Z',
    channelId: CHANNEL_ID,
    customerGroupId: CUSTOMER_GROUP_ID,
    customerId: CUSTOMER_ID,
  });

  assert.equal(calls.length, 1, 'preview pricing must stay O(1) database queries per search page');
  assert.match(calls[0].sql, /pi\.variant_id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(calls[0].params[1], [VARIANT_A, VARIANT_B, VARIANT_C]);
  assert.equal(calls[0].params[4], '1');
  assert.equal(calls[0].params[5], CHANNEL_ID);
  assert.equal(calls[0].params[6], CUSTOMER_GROUP_ID);
  assert.equal(calls[0].params[7], CUSTOMER_ID);

  assert.equal(result.get(VARIANT_A)?.resolution?.systemUnitPriceMinor, '85000');
  assert.equal(result.get(VARIANT_A)?.resolution?.finalUnitPriceMinor, '85000');
  assert.equal(result.get(VARIANT_B)?.resolution?.resolutionStatus, 'MANUAL_PRICE_REQUIRED');
  assert.equal(result.get(VARIANT_C)?.resolution?.systemUnitPriceMinor, '80000');
});
