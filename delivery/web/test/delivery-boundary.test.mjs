import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const packageSource = read('package.json');
const middlewareSource = read('middleware.ts');
const authSource = read('lib/delivery-auth.ts');
const readGatewaySource = read('lib/core-api.ts');
const attemptGatewaySource = read('lib/attempt-api.ts');
const homeSource = read('app/page.tsx');
const detailSource = read('app/trips/[tripId]/page.tsx');
const attemptPanelSource = read('app/trips/[tripId]/delivery-attempt-panel.tsx');
const attemptRouteSource = read('app/api/trips/[tripId]/assignments/[assignmentId]/attempts/route.ts');
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

test('setup-pending production blocks all attempt mutations and invents no driver identity', () => {
  assert.match(homeSource, /deliverySetupPending/);
  assert.match(homeSource, /Chưa có hồ sơ tài xế đang hoạt động/);
  assert.match(homeSource, /không tạo dữ liệu giao hàng giả/);
  assert.match(detailSource, /deliverySetupPending/);
  assert.match(attemptRouteSource, /deliverySetupPending/);
  assert.match(attemptRouteSource, /DELIVERY_DRIVER_SETUP_PENDING/);
  assert.match(middlewareSource, /DELIVERY_SETUP_USERNAME/);
  assert.match(middlewareSource, /request\.nextUrl\.pathname !== '\/'/);
  assert.doesNotMatch(homeSource, /employeeId:\s*['"][0-9a-f-]+/i);
});

test('Core credential remains server-only and browser cannot supply driver identity', () => {
  assert.match(readGatewaySource, /import 'server-only'/);
  assert.match(attemptGatewaySource, /import 'server-only'/);
  assert.match(attemptGatewaySource, /DELIVERY_CORE_API_TOKEN/);
  assert.match(attemptGatewaySource, /x-npp-delivery-employee-id/);
  assert.match(attemptGatewaySource, /Idempotency-Key/);
  assert.match(attemptGatewaySource, /cache: 'no-store'/);
  assert.doesNotMatch(attemptGatewaySource, /NEXT_PUBLIC_.*TOKEN/);
  assert.match(attemptRouteSource, /UNTRUSTED_DRIVER_IDENTITY/);
  assert.doesNotMatch(detailSource + attemptPanelSource, /DELIVERY_CORE_API_TOKEN|CORE_API_INTERNAL_URL|employeeId|driverId/);
});

test('driver UI records only Phase 6E.4 terminal outcomes with exact partial quantities', () => {
  assert.match(detailSource, /DeliveryAttemptPanel/);
  assert.match(attemptPanelSource, /delivered_full/);
  assert.match(attemptPanelSource, /delivered_partial/);
  assert.match(attemptPanelSource, /failed/);
  assert.match(attemptPanelSource, /rescheduled/);
  assert.match(attemptPanelSource, /inventoryIssueLineId/);
  assert.match(attemptPanelSource, /deliveredBaseQuantity/);
  assert.match(attemptPanelSource, /Idempotency-Key/);
  assert.match(attemptPanelSource, /router\.refresh/);
  assert.match(attemptPanelSource, /Kết quả đã khóa và chỉ đọc/);
  assert.doesNotMatch(attemptPanelSource, /POD|GPS|R2|COD|payment|Inventory IN/i);
});

test('attempt proxy exposes POST only and does not leak adjacent capabilities', () => {
  assert.match(attemptRouteSource, /export async function POST/);
  assert.doesNotMatch(attemptRouteSource, /export async function (GET|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(attemptGatewaySource + attemptRouteSource, /inventory_movements|customer_return|proof_of_delivery|signature|latitude|longitude/i);
});
