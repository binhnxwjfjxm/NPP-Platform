import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryPath = fileURLToPath(new URL('../src/db/repositories/sales-order-delivery-execution.js', import.meta.url));
const servicePath = fileURLToPath(new URL('../src/services/sales-order.js', import.meta.url));

test('danh sách đơn lấy tổng tiền từ đúng phiên bản hiện tại trong cùng batch', async () => {
  const [repository, service] = await Promise.all([
    readFile(repositoryPath, 'utf8'),
    readFile(servicePath, 'utf8'),
  ]);

  assert.match(repository, /version\.version_number = sales_order\.current_version_number/);
  assert.match(repository, /version\.delivery_execution_mode,\s*version\.total/s);
  assert.match(service, /total: String\(row\.total \?\? 0\)/);
  assert.match(service, /total: fact\?\.total \?\? '0'/);
  assert.doesNotMatch(service, /receivableRemainingAmount.*total/s);
});
