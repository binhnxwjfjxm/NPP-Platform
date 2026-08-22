import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const readWorkspace = async () => (await Promise.all([read('app/page.tsx'), read('app/retail-workspace.tsx')])).join('\n');

test('Lô 4 có giỏ hàng, chọn nhiều sản phẩm và chỉ một chỉ số Khả dụng', async () => {
  const page = await readWorkspace();
  assert.match(page, /Chọn sản phẩm/); assert.match(page, /Thêm \{selected\.size\} sản phẩm vào đơn/); assert.match(page, /Nhóm sản phẩm/); assert.match(page, /Khả dụng/); assert.match(page, /Không áp dụng/);
  assert.match(page, /item\.versionNumber === order\.currentVersionNumber/); assert.match(page, /setCustomerMode\(next\.customerMode\)/); assert.match(page, /setCustomerId\(next\.customerId\)/); assert.match(page, /setCart\(next\.status === 'draft' \? cartFromOrder\(next\) : \[\]\)/);
  assert.doesNotMatch(page, /Tồn thực tế|Đang giữ|Vị trí|Lô hàng/);
});

test('Retail giữ Idempotency-Key qua shared contract và retry cùng thao tác', async () => {
  const page = await readWorkspace();
  assert.match(page, /import \{ createIdempotencyKey \} from '@npp\/contracts'/); assert.match(page, /keys\.current\.get\(slot\)/); assert.match(page, /createIdempotencyKey\(`retail-\$\{action\}`\)/); assert.match(page, /operationKeys\.current\.get\(slot\)/);
});

test('gateway Retail chỉ gọi capability Công Ty cố định và Xuất kho dùng PICKUP', async () => {
  const route = await read('app/api/retail/[...segments]/route.ts');
  assert.match(route, /\/api\/retail\/products/); assert.match(route, /\/api\/retail\/sales-orders\/\$\{salesOrderId\(path\[1\]\)\}\/availability/); assert.match(route, /mode: 'PICKUP'/); assert.match(route, /const UUID_PATTERN/); assert.match(route, /salesOrderId\(path\[1\]\)/); assert.doesNotMatch(route, /decodeURIComponent/); assert.match(route, /\/api\/pickup-sales-orders\/\$\{orderId\}\/complete/); assert.match(route, /\/api\/pickup-sales-orders\/\$\{orderId\}\/settlement/); assert.doesNotMatch(route, /CORE_API_INTERNAL_URL/);
});

test('gateway Retail lấy tổng tiền từ phiên bản hiện tại và tải lại sau Hoàn thành', async () => {
  const route = await read('app/api/retail/[...segments]/route.ts');
  assert.match(route, /function normalizeOrderAmounts/);
  assert.match(route, /version\.versionNumber/);
  assert.match(route, /order\.currentVersionNumber/);
  assert.match(route, /total: String\(current\.total \?\? order\.total \?\? '0'\)/);
  assert.match(route, /if \(action === 'complete'\)/);
  assert.match(route, /const reloaded = await companyRequest<unknown>\(\{ path: `\/api\/sales-orders\/\$\{orderId\}`/);
  assert.match(route, /return json\(await enrichRetailProductNames\(reloaded\.data, reloaded\.requestId\), reloaded\.requestId\)/);
});

test('URL Công Ty và token chỉ nằm phía server', async () => {
  const gateway = await read('lib/company-gateway.ts');
  assert.match(gateway, /import 'server-only'/); assert.match(gateway, /CORE_API_INTERNAL_URL/); assert.match(gateway, /Authorization: `Bearer \$\{workforceToken\(\)\}`/); assert.doesNotMatch(gateway, /NEXT_PUBLIC_CORE_API/); assert.match(gateway, /!candidate\.includes\('\\\\'\)/); assert.match(gateway, /%\(\?:2f\|5c\)/i);
});

test('đăng nhập Retail nhận được mã xác minh khi Công Ty yêu cầu', async () => { const login = await read('app/login/page.tsx'); assert.match(login, /name="ownerCode"/); assert.match(login, /one-time-code/); });

test('route Công Ty chọn pickup engine nhưng vẫn giữ wrapper Giao thủ công', async () => { const route = await readRepo('npp-core/api/src/routes/sales-orders.js'); assert.match(route, /pickupStockIssueService\.issuePickupSalesOrderStock/); assert.match(route, /manualStockIssueService\.issueManualSalesOrderStock/); assert.match(route, /pickup \? 'pickup_stock_issue' : 'manual_stock_issue'/); });