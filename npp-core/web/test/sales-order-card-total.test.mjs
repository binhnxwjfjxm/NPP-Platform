import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workspacePath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../app/sales/sales-orders/sales-order-card-polish.module.css', import.meta.url));

test('card đơn ưu tiên tên khách và tổng tiền, số đơn rút gọn nằm dòng phụ', async () => {
  const [workspace, css] = await Promise.all([
    readFile(workspacePath, 'utf8'),
    readFile(cssPath, 'utf8'),
  ]);

  assert.match(workspace, /formatMoney/);
  assert.match(workspace, /function orderCardTotal/);
  assert.match(workspace, /activeVersion\(order\)\?\.total/);
  assert.match(workspace, /SalesOrderListValue\)\.total/);
  assert.match(workspace, /orderCardCustomerRow/);
  assert.match(workspace, /orderCardCustomerName/);
  assert.match(workspace, /orderCardNumberDivider/);
  assert.match(workspace, /aria-hidden="true">\|<\/span>/);
  assert.match(workspace, /orderCardTotal\}\>\{formatMoney\(orderCardTotal\(order\)\)\}đ/);
  assert.match(workspace, /orderCardCompactNumber/);
  assert.match(workspace, /order\.number \? compactOrderNumber\(order\.number\) : 'Đơn đặt hàng chưa cấp số'/);
  assert.doesNotMatch(workspace, /`#\$\{compactOrderNumber\(order\.number\)\}`/);
  assert.match(css, /\.orderCardNumberDivider\s*\{[^}]*color:\s*#aab3af;/s);
  assert.match(css, /\.orderCardCompactNumber\s*\{[^}]*color:\s*#7a8580;[^}]*font-size:\s*\.67rem;[^}]*opacity:\s*\.78;/s);
  assert.match(css, /\.orderCardTotal\s*\{[^}]*color:\s*#155c46;[^}]*font-weight:\s*850;[^}]*white-space:\s*nowrap;/s);
});
