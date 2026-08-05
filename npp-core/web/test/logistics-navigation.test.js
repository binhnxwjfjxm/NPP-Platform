import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreShellSource = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');
const wrapperSource = readFileSync(new URL('../app/components/app-shell.tsx', import.meta.url), 'utf8');

const expectedItems = [
  ['/inventory/delivery-orders', 'Phiếu giao hàng', 'nav-delivery-orders'],
  ['/logistics/trips', 'Lập & xếp chuyến', 'nav-logistics-trips'],
  ['/logistics/dispatch', 'Bàn giao & xuất phát', 'nav-logistics-dispatch'],
  ['/logistics/delivery-attempts', 'Kết quả lần giao', 'nav-logistics-delivery-attempts'],
  ['/logistics/trip-reconciliation', 'Đối soát cuối chuyến', 'nav-logistics-trip-reconciliation'],
  ['/inventory/customer-returns', 'Hàng khách trả', 'nav-customer-returns'],
];

test('NPP exposes the complete delivery workflow in one persistent left navigation group', () => {
  assert.match(coreShellSource, /title: 'Giao nhận & điều phối'/);
  assert.match(coreShellSource, /testId: 'logistics-menu-toggle'/);

  for (const [href, label, testId] of expectedItems) {
    assert.match(coreShellSource, new RegExp(`href: '${href.replaceAll('/', '\\/')}'`));
    assert.match(coreShellSource, new RegExp(`label: '${label}'`));
    assert.match(coreShellSource, new RegExp(`testId: '${testId}'`));
  }
});

test('delivery-order and customer-return screens activate Logistics instead of Inventory', () => {
  assert.match(coreShellSource, /!pathname\.startsWith\('\/inventory\/delivery-orders'\)/);
  assert.match(coreShellSource, /!pathname\.startsWith\('\/inventory\/customer-returns'\)/);
  assert.match(coreShellSource, /pathname\.startsWith\('\/inventory\/delivery-orders'\)/);
  assert.match(coreShellSource, /pathname\.startsWith\('\/inventory\/customer-returns'\)/);
});

test('NPP does not hide logistics navigation in route-dependent topbar shortcuts', () => {
  assert.doesNotMatch(wrapperSource, /usePathname/);
  assert.doesNotMatch(wrapperSource, /operationalShortcuts/);
  assert.doesNotMatch(wrapperSource, /logistics-delivery-order-shortcut/);
});
