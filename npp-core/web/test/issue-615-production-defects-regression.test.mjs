import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('Issue #615 production fix routes driver custody to the COD handler and exports its service', () => {
  const routes = read('npp-core/api/src/routes/inventory.js');
  const service = read('npp-core/api/src/services/cod-settlement.js');

  const custodyRoute = routes.indexOf("pathname === '/api/logistics/driver/cod-custody'");
  const genericLogistics = routes.indexOf("if (pathname === '/api/logistics' || pathname.startsWith('/api/logistics/'))");

  assert.ok(custodyRoute >= 0, 'driver custody route must be explicitly owned by the COD handler');
  assert.ok(genericLogistics > custodyRoute, 'driver custody must be routed before the generic logistics handler');
  assert.match(routes, /pathname === '\/api\/logistics\/driver\/cod-custody'[\s\S]{0,320}handleCodDriverRoutes/);
  assert.match(service, /listDriverCodCustodyTripIds/);
});

test('Issue #615 production fix shows product identity and office Vietnamese in inventory reporting', () => {
  const source = read('npp-core/web/app/components/inventory-reporting-workspace.tsx');

  assert.match(source, /\/api\/inventory\/balances\?limit=1000/);
  assert.match(source, /product_name/);
  assert.match(source, /Sản phẩm \/ mã hàng/);
  assert.match(source, /Tồn kho/);
  assert.match(source, /Đã giữ/);
  assert.match(source, /Có thể xuất/);
  assert.match(source, /Báo cáo không tạo nguồn tồn kho riêng/);

  const retiredUserFacingCopy = [
    'Đếm SKU có on-hand dương',
    'Vị thế có reserved quantity dương.',
    'Chỉ lô canonical có on-hand dương.',
    'MWA_V1, chỉ cộng vị thế COSTED.',
    'Ngoại lệ costing',
    '<strong>Watermark:</strong>',
    'Projection tồn',
    '>On-hand<',
    '>Reserved<',
    '>Available<',
    '>Cost<',
    'Dòng movement',
    'Loại movement',
    'Ngoại lệ quantity ↔ costing',
    'Ledger qty',
    'Costing qty',
    '>Anomaly<',
  ];

  for (const oldCopy of retiredUserFacingCopy) {
    assert.equal(source.includes(oldCopy), false, `retired mixed-language copy remains: ${oldCopy}`);
  }
});

test('Issue #615 production fix keeps the final close action visible before optional fields and canClose-gated', () => {
  const styles = read('npp-core/web/app/logistics/trip-reconciliation/trip-reconciliation-workspace.module.css');
  const workspace = read('npp-core/web/app/logistics/trip-reconciliation/trip-reconciliation-workspace.tsx');

  assert.match(styles, /section\[id='trip-reconciliation-close'\] > button \{ order: 2; width: 100%; min-height: 48px;/);
  assert.match(styles, /section\[id='trip-reconciliation-close'\] > label \{ order: 3; \}/);
  assert.match(workspace, /disabled=\{busy \|\| !detail\.canClose\}>Chốt đối soát & đóng chuyến<\/button>/);
  assert.match(workspace, /createIdempotencyKey\('trip-reconciliation-close'\)/);
});
