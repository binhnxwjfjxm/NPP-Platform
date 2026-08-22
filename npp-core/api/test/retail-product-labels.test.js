import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRetailProductLabels,
  retailProductLabelsInternals,
} from '../src/services/retail-product-labels.js';

const VARIANT_A = '11111111-1111-4111-8111-111111111111';
const VARIANT_B = '22222222-2222-4222-8222-222222222222';

test('Retail product labels trả tên sản phẩm thật theo variant và giữ thứ tự yêu cầu', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [
          {
            variant_id: VARIANT_B,
            sku: 'SKU-B',
            variant_name: '500 g / GÓI',
            product_code: 'SP-B',
            product_name: 'Bột cacao',
            unit_code: 'GOI',
          },
          {
            variant_id: VARIANT_A,
            sku: 'SKU-A',
            variant_name: '1 kg / GÓI',
            product_code: 'SP-A',
            product_name: 'Bột kem',
            unit_code: 'GOI',
          },
        ],
      };
    },
  };

  const result = await getRetailProductLabels(client, {
    requestContext: { installationId: 'installation-test' },
    payload: { variantIds: [VARIANT_A, VARIANT_B, VARIANT_A] },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.labels.map((label) => label.variantId), [VARIANT_A, VARIANT_B]);
  assert.equal(result.labels[0].productName, 'Bột kem');
  assert.equal(result.labels[0].variantName, '1 kg / GÓI');
  assert.equal(result.labels[0].sku, 'SKU-A');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /product\.name AS product_name/);
  assert.match(calls[0].sql, /variant\.name AS variant_name/);
  assert.match(calls[0].sql, /variant\.id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(calls[0].params, ['installation-test', [VARIANT_A, VARIANT_B]]);
});

test('Retail product labels chặn danh sách variant sai trước khi truy vấn DB', async () => {
  let queried = false;
  const client = { async query() { queried = true; return { rows: [] }; } };
  const result = await getRetailProductLabels(client, {
    requestContext: { installationId: 'installation-test' },
    payload: { variantIds: ['khong-hop-le'] },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_VARIANT_IDS');
  assert.equal(queried, false);
  assert.equal(retailProductLabelsInternals.MAX_VARIANTS, 100);
});
