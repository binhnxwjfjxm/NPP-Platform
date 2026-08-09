import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const packageSource = read('package.json');
const middlewareSource = read('middleware.ts');
const authSource = read('lib/delivery-auth.ts');
const sessionSource = read('lib/delivery-session.ts');
const authClientSource = read('lib/internal-auth-client.ts');
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

test('Delivery identity comes only from canonical Core workforce session', () => {
  assert.match(sessionSource, /hp_delivery_session/);
  assert.match(authClientSource, /\/api\/internal-auth/);
  assert.match(middlewareSource, /\/api\/internal-auth\/me/);
  assert.match(authSource, /INTERNAL_IDENTITY_VERSION = 'v2'/);
  assert.match(authSource, /employeeId/);
  assert.doesNotMatch(authSource + sessionSource + middlewareSource, /DELIVERY_WEB_USERS_JSON|DELIVERY_SETUP_PASSWORD|DELIVERY_CORE_API_TOKEN/);
  assert.match(middlewareSource, /DELIVERY_HTTPS_REQUIRED/);
});

test('legacy setup mode is inert and invents no driver identity', () => {
  assert.match(homeSource, /deliverySetupPending/);
  assert.match(detailSource, /deliverySetupPending/);
  assert.match(authSource, /deliverySetupPending\(\): boolean[\s\S]*return false/);
  assert.doesNotMatch(homeSource, /employeeId:\s*['"][0-9a-f-]+/i);
});

test('Core credential remains HttpOnly and browser cannot supply driver identity', () => {
  assert.match(readGatewaySource, /import 'server-only'/);
  assert.match(attemptGatewaySource, /import 'server-only'/);
  assert.match(attemptGatewaySource, /requireDeliverySessionToken/);
  assert.match(attemptGatewaySource, /Idempotency-Key/);
  assert.match(attemptGatewaySource, /cache: 'no-store'/);
  assert.doesNotMatch(attemptGatewaySource, /DELIVERY_CORE_API_TOKEN|x-npp-delivery-employee-id|NEXT_PUBLIC_.*TOKEN/);
  assert.match(attemptRouteSource, /UNTRUSTED_DRIVER_IDENTITY/);
  assert.doesNotMatch(detailSource + attemptPanelSource, /DELIVERY_CORE_API_TOKEN|CORE_API_INTERNAL_URL|driverId/);
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
  assert.doesNotMatch(attemptPanelSource, /proofOfDelivery|signatureUrl|gpsLatitude|gpsLongitude|codAmount|paymentId|inventoryMovementId/);
});

test('attempt proxy exposes POST only and does not leak adjacent capabilities', () => {
  assert.match(attemptRouteSource, /export async function POST/);
  assert.doesNotMatch(attemptRouteSource, /export async function (GET|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(attemptGatewaySource + attemptRouteSource, /inventory_movements|customer_return|proof_of_delivery|signature|latitude|longitude/i);
});
