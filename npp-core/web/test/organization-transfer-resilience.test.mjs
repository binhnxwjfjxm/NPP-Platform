import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const organizationPage = readFileSync(new URL('../app/organization/page.tsx', import.meta.url), 'utf8');
const organizationLayout = readFileSync(new URL('../app/organization/organization-overview-layout.module.css', import.meta.url), 'utf8');
const transferPage = readFileSync(new URL('../app/inventory/transfers/page.tsx', import.meta.url), 'utf8');

test('organization overview balances quick access and hierarchy on desktop', () => {
  assert.match(organizationPage, /organization-overview-layout\.module\.css/);
  assert.match(organizationPage, /className=\{layoutStyles\.scope\}/);
  assert.match(organizationLayout, /grid-template-columns:\s*minmax\(280px,\s*0\.9fr\)\s*minmax\(0,\s*1\.35fr\)/);
  assert.match(organizationLayout, /section:nth-child\(2\)[\s\S]*grid-column:\s*auto/);
  assert.match(organizationLayout, /section:nth-child\(3\)[\s\S]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(organizationLayout, /repeat\(auto-fit,\s*minmax\(280px,\s*1fr\)\)/);
  assert.match(organizationLayout, /@media \(max-width:\s*1180px\)[\s\S]*grid-template-columns:\s*1fr/);
});

test('inventory transfer initial load keeps successful data when one source is unavailable', () => {
  assert.match(transferPage, /Promise\.allSettled\(/);
  assert.doesNotMatch(transferPage, /await Promise\.all\(/);
  assert.match(transferPage, /transfersResult\.status === 'fulfilled'/);
  assert.match(transferPage, /inTransitResult\.status === 'fulfilled'/);
  assert.match(transferPage, /balancesResult\.status === 'fulfilled'/);
  assert.match(transferPage, /locationsResult\.status === 'fulfilled'/);
  assert.match(transferPage, /Danh sách phiếu/);
  assert.match(transferPage, /Hàng đang đi đường/);
  assert.match(transferPage, /Tồn kho khả dụng/);
  assert.match(transferPage, /Vị trí kho/);
  assert.match(transferPage, /InitialLoadRetry enabled=\{Boolean\(initialError\)\} retryKey="inventory-transfers"/);
});
