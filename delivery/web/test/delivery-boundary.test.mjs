import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const packageSource = read('package.json');
const middlewareSource = read('middleware.ts');
const authSource = read('lib/delivery-auth.ts');
const gatewaySource = read('lib/core-api.ts');
const homeSource = read('app/page.tsx');
const detailSource = read('app/trips/[tripId]/page.tsx');
const vercelSource = read('vercel.json');
const manifestSource = read('app/manifest.ts');

test('Delivery frontend is a standalone mobile Next app with Auto Deploy OFF', () => {
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.name, 'delivery-web');
  assert.match(packageJson.scripts.verify, /typecheck/);
  assert.match(packageJson.scripts.verify, /build/);
  assert.equal(JSON.parse(vercelSource).git.deploymentEnabled, false);
  assert.match(manifestSource, /display: 'standalone'/);
  assert.match(manifestSource, /orientation: 'portrait'/);
});

test('app auth maps unique credentials to server-owned employee identity', () => {
  assert.match(authSource, /DELIVERY_WEB_USERS_JSON/);
  assert.match(authSource, /DELIVERY_SETUP_MODE/);
  assert.match(authSource, /employeeId/);
  assert.match(authSource, /DELIVERY_WEB_USER_DUPLICATE/);
  assert.match(authSource, /constantTimeEqual/);
  assert.doesNotMatch(authSource, /NEXT_PUBLIC_/);
  assert.match(middlewareSource, /DELIVERY_AUTH_NOT_CONFIGURED/);
  assert.match(middlewareSource, /DELIVERY_HTTPS_REQUIRED/);
  assert.match(middlewareSource, /DELIVERY_DRIVER_SETUP_PENDING/);
});

test('setup-pending production is protected and never invents driver identity', () => {
  assert.match(homeSource, /deliverySetupPending/);
  assert.match(homeSource, /Chưa có hồ sơ tài xế đang hoạt động/);
  assert.match(homeSource, /không tạo dữ liệu giao hàng giả/);
  assert.match(detailSource, /deliverySetupPending/);
  assert.match(middlewareSource, /DELIVERY_SETUP_USERNAME/);
  assert.match(middlewareSource, /request\.nextUrl\.pathname !== '\/'/);
  assert.doesNotMatch(homeSource, /employeeId:\s*['"][0-9a-f-]+/i);
});

test('Core token remains server-only and driver identity is a trusted header', () => {
  assert.match(gatewaySource, /import 'server-only'/);
  assert.match(gatewaySource, /DELIVERY_CORE_API_TOKEN/);
  assert.match(gatewaySource, /x-npp-delivery-employee-id/);
  assert.match(gatewaySource, /cache: 'no-store'/);
  assert.doesNotMatch(gatewaySource, /NEXT_PUBLIC_.*TOKEN/);
  assert.doesNotMatch(homeSource + detailSource, /DELIVERY_CORE_API_TOKEN|CORE_API_INTERNAL_URL/);
});

test('slice is read-only and contains no attempt POD GPS or COD actions', () => {
  assert.match(homeSource, /Chế độ chỉ xem/);
  assert.match(detailSource, /Không ghi kết quả tại màn này/);
  assert.doesNotMatch(homeSource + detailSource, /<button|fetch\(|method:\s*['"]POST|Idempotency-Key/);
  assert.doesNotMatch(homeSource + detailSource, /Giao thành công|Giao thất bại|Tải POD|Chụp ảnh|Thu COD/);
});
