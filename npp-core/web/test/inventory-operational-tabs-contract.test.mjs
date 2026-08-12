import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('delivery order uses two workflow tabs without splitting lifecycle actions', () => {
  const workspace = source('../app/inventory/delivery-orders/delivery-order-workspace.tsx');

  assert.match(workspace, /type DeliveryOrderTab = 'create' \| 'manage'/);
  assert.match(workspace, /\{ id: 'create', label: 'Lập chứng từ' \}/);
  assert.match(workspace, /\{ id: 'manage', label: 'Theo dõi & xử lý' \}/);
  assert.match(workspace, /useState<DeliveryOrderTab>\('create'\)/);
  assert.match(workspace, /onChange=\{setActiveTab\}/);
  assert.match(workspace, /<WorkspaceTabPanel tabId="create"/);
  assert.match(workspace, /<WorkspaceTabPanel tabId="manage"/);
  assert.match(workspace, /data-testid="delivery-order-create"/);
  assert.match(workspace, /data-testid="delivery-order-confirm"/);
  assert.match(workspace, /data-testid="delivery-order-cancel"/);
  assert.match(workspace, /data-testid="delivery-order-pickup-handover"/);
  assert.match(workspace, /data-testid="delivery-order-reverse-issue"/);
  assert.match(workspace, /setActiveTab\('manage'\);[\s\S]*await loadAll\(result\.deliveryOrder\.id\)/);

  const statsIndex = workspace.indexOf('className={styles.stats}');
  const tabsIndex = workspace.indexOf('<WorkspaceTabs');
  assert.ok(statsIndex >= 0 && tabsIndex > statsIndex, 'summary stays above workflow tabs');
});

test('customer return uses two workflow tabs and keeps receive/cancel together', () => {
  const workspace = source('../app/inventory/customer-returns/customer-return-workspace.tsx');

  assert.match(workspace, /type CustomerReturnTab = 'create' \| 'process'/);
  assert.match(workspace, /\{ id: 'create', label: 'Lập phiếu trả' \}/);
  assert.match(workspace, /\{ id: 'process', label: 'Nhận & xử lý' \}/);
  assert.match(workspace, /useState<CustomerReturnTab>\('create'\)/);
  assert.match(workspace, /onChange=\{setActiveTab\}/);
  assert.match(workspace, /<WorkspaceTabPanel tabId="create"/);
  assert.match(workspace, /<WorkspaceTabPanel tabId="process"/);
  assert.match(workspace, /data-testid="customer-return-create"/);
  assert.match(workspace, /data-testid="customer-return-receive"/);
  assert.match(workspace, /data-testid="customer-return-cancel"/);
  assert.match(workspace, /setActiveTab\('process'\);[\s\S]*await loadAll\(result\.customerReturn\.id\)/);

  const statsIndex = workspace.indexOf('className={styles.stats}');
  const tabsIndex = workspace.indexOf('<WorkspaceTabs');
  assert.ok(statsIndex >= 0 && tabsIndex > statsIndex, 'summary stays above workflow tabs');
});

test('tab switches are local UI state and do not refetch or reset the workflow', () => {
  const delivery = source('../app/inventory/delivery-orders/delivery-order-workspace.tsx');
  const returns = source('../app/inventory/customer-returns/customer-return-workspace.tsx');

  assert.match(delivery, /onChange=\{setActiveTab\}/);
  assert.match(returns, /onChange=\{setActiveTab\}/);
  assert.doesNotMatch(delivery, /onChange=\{\(tabId\)[\s\S]*loadAll/);
  assert.doesNotMatch(returns, /onChange=\{\(tabId\)[\s\S]*loadAll/);
});
