import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const page = read('../app/organization/warehouses/page.tsx');
const workspace = read('../app/organization/warehouses/warehouse-workspace.tsx');
const tabs = read('../app/organization/warehouses/warehouse-tabs.tsx');
const history = read('../app/organization/warehouses/location-mode-history/page.tsx');
const legacyLocations = read('../app/organization/locations/page.tsx');

test('warehouse workspace consolidates list, quick setup, layout and history', () => {
  assert.match(page, /WarehouseWorkspace/);
  assert.doesNotMatch(page, /historyShortcut/);
  assert.match(tabs, /Kho hàng/);
  assert.match(tabs, /Thiết lập nhanh/);
  assert.match(tabs, /Sơ đồ kho/);
  assert.match(tabs, /Lịch sử/);
  assert.match(workspace, /data-testid="warehouse-quick-setup"/);
  assert.match(workspace, /data-testid="warehouse-layout-workspace"/);
});

test('warehouse layout uses business wording instead of ambiguous position wording', () => {
  assert.match(workspace, />Quản lý sơ đồ</);
  assert.match(workspace, /Thiết lập sơ đồ kho/);
  assert.match(workspace, /Khu vực nhận hàng ban đầu/);
  assert.match(workspace, /Có sơ đồ kho/);
  assert.match(workspace, /Không dùng sơ đồ/);
  assert.match(workspace, /Chưa thiết lập sơ đồ/);
  assert.doesNotMatch(workspace, />Quản lý vị trí</);
});

test('legacy location route points into the warehouse layout and history is integrated', () => {
  assert.match(legacyLocations, /redirect\('\/organization\/warehouses\?tab=layout'\)/);
  assert.match(history, /WarehouseTabs active="history"/);
  assert.match(history, /Lịch sử sơ đồ kho/);
  assert.doesNotMatch(history, /Lịch sử quản lý vị trí/);
});
