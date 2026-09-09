import assert from 'node:assert/strict';
import test from 'node:test';
import * as repository from '../src/db/repositories/sales-order.js';

test('Tìm hàng bán hỗ trợ tiếng Việt theo từng từ và giữ ưu tiên mã chính xác', async () => {
  const calls = [];
  const client = {
    async query(statement, params) {
      calls.push({ statement, params });
      return { rows: [] };
    },
  };

  await repository.searchSalesOrderSkuOptions(client, {
    installationId: '66666666-6666-4666-8666-666666666666',
    search: 'thạch dừa vải',
    limit: 30,
    offset: 0,
  });

  assert.equal(calls.length, 1);
  const first = calls[0];
  assert.equal(first.params[2], 'thach dua vai');
  assert.deepEqual(first.params[3], ['thach', 'dua', 'vai']);
  assert.equal(first.params[5], false);
  assert.equal(first.params.at(-2), 30);
  assert.equal(first.params.at(-1), 0);
  assert.match(first.statement, /FROM unnest\(\$4::text\[\]\) AS search_token/);
  assert.match(first.statement, /p\.category_id = \$5::uuid/);
  assert.match(first.statement, /translate\(lower\(COALESCE\(p\.name, ''\)\), \$7, \$8\)/);
  assert.match(first.statement, /WHEN upper\(pv\.sku\) = \$2 THEN 0/);
  assert.match(first.statement, /WHEN \$6::boolean AND upper\(pv\.sku\) LIKE \$2 \|\| '%' THEN 3/);
  assert.match(first.statement, /LIMIT \$9 OFFSET \$10/);

  await repository.searchSalesOrderSkuOptions(client, {
    installationId: '66666666-6666-4666-8666-666666666666',
    search: 'ma lựu',
  });
  assert.equal(calls[1].params[2], 'ma luu');
  assert.deepEqual(calls[1].params[3], ['ma', 'luu']);
});
