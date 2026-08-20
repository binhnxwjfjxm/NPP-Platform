import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const readWorkspace = async () => (await Promise.all([read('app/page.tsx'), read('app/retail-workspace.tsx')])).join('\n');

test('Lô 7 đăng nhập tách riêng bước mã xác minh và dùng logo Công Ty', async () => { const [login, route] = await Promise.all([read('app/login/page.tsx'), read('app/api/auth/login/route.ts')]); assert.match(login, /challenge \? <>/); assert.match(login, /logo-transparent\.png/); assert.match(login, /Đổi tài khoản/); assert.match(login, /autoComplete="one-time-code"/); assert.match(route, /challengeRequired/); assert.match(route, /INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED/); });

test('Lô 7 Retail không phụ thuộc kênh bán mặc định và Công Ty sở hữu kênh RETAIL', async () => { const [page, entry, catalog, gateway] = await Promise.all([readWorkspace(), readRepo('npp-core/api/src/services/sales-order-entry.js'), readRepo('npp-core/api/src/services/retail-catalog.js'), read('app/api/retail/[...segments]/route.ts')]); assert.doesNotMatch(page, /defaultSalesChannelId/); assert.doesNotMatch(page, /Công Ty chưa cấu hình kênh bán mặc định/); assert.match(entry, /sourceApp.*retail-web/); assert.match(entry, /code: 'RETAIL'/); assert.match(catalog, /ensureSystemSalesChannel/); assert.match(catalog, /resolveRetailPrice/); assert.match(gateway, /path: '\/api\/retail\/price'/); });

test('Lô 7 giỏ tạo nháp ngầm để chỉ SKU đã chọn mới thấy Khả dụng', async () => { const page = await readWorkspace(); assert.match(page, /lastDraftFingerprint/); assert.match(page, /draft-sync/); assert.match(page, /\/api\/retail\/orders\/\$\{order\.id\}\/availability/); assert.match(page, /Khả dụng \{order \? availabilityLabel/); assert.doesNotMatch(page, /Tồn thực tế|Đang giữ|Vị trí|Lô hàng/); });

test('Lô 7 có ảnh R2, giá picker, trạng thái Đã xuất kho và phương thức thu tiền', async () => { const [page, css] = await Promise.all([readWorkspace(), read('app/retail-lot7.css')]); assert.match(page, /app-customer\/products/); assert.match(page, /Đang tính giá/); assert.match(page, /id: 'issued', label: 'Đã xuất kho'/); assert.match(page, /PaymentMethod = 'CASH' \| 'BANK_TRANSFER'/); assert.match(page, /paymentMethod/); assert.match(css, /compact-product-card/); assert.match(css, /lot7-payment/); });
