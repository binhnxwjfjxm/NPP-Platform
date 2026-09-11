import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.module.css', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../lib/manual-inbound-operator-gateway.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/inventory/manual-inbounds/operator/[action]/route.ts', import.meta.url), 'utf8');

test('Nhập kho thủ công tận dụng chiều ngang và lịch sử không chồng lên vùng nhập', () => {
  assert.match(css, /workspaceGrid\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(320px,360px\)/);
  assert.match(css, /workspaceGrid\{[^}]*width:100%[^}]*max-width:none/);
  assert.match(workspace, /className=\{styles\.entryColumn\}/);
  assert.match(workspace, /className=\{styles\.historyColumn\}/);
  assert.match(css, /historyColumn\{[^}]*position:static/);
  assert.match(css, /itemsCard\{min-height:0/);
  assert.match(css, /productColumn\{[^}]*min-width:300px/);
});

test('Thông tin chứng từ gọn, có Nhà cung cấp tùy chọn và Ghi chú một dòng', () => {
  assert.match(workspace, /<AppShell title="Nhập kho thủ công" kicker="Kho">/);
  assert.doesNotMatch(workspace, /subtitle=/);
  assert.match(css, /headerGrid\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(workspace, /<span>Nhà cung cấp<\/span><select value=\{supplierId\}/);
  assert.match(workspace, /<option value="">Không chọn<\/option>/);
  assert.match(workspace, /\/api\/inventory\/manual-inbounds\/operator\/suppliers/);
  assert.match(workspace, /className=\{styles\.noteField\}><span>Ghi chú[\s\S]*?<input value=\{note\}/);
  assert.doesNotMatch(workspace, /<textarea value=\{note\}/);
});

test('Nhập trực tiếp và Nhập từ file dùng chung preview-confirm canonical', () => {
  assert.match(workspace, /Nhập trực tiếp/);
  assert.match(workspace, /Nhập từ file/);
  assert.match(workspace, /MIN_PRODUCT_SEARCH_LENGTH/);
  assert.match(workspace, /\/api\/inventory\/manual-inbounds\/operator\/products/);
  assert.match(workspace, /createIdempotencyKey\('manual-inbound-confirm'\)/);
  assert.match(workspace, /\/api\/inventory\/manual-inbounds\/operator\/preview/);
  assert.match(workspace, /\/api\/inventory\/manual-inbounds\/operator\/confirm/);
});

test('Kết quả kiểm tra giữ cột cũ và bổ sung tồn hiện tại, tồn sau nhập', () => {
  assert.match(workspace, /<th>Tồn hiện tại<\/th><th>Tồn sau nhập<\/th>/);
  assert.match(workspace, /row\.currentOnHand/);
  assert.match(workspace, /row\.afterOnHand/);
  assert.match(css, /previewTable\{min-width:1420px/);
});

test('Web gateway có endpoint riêng cho hàng và nhà cung cấp của Nhập kho thủ công', () => {
  assert.match(gateway, /searchManualInboundOperatorProducts/);
  assert.match(gateway, /operator\/products/);
  assert.match(gateway, /listManualInboundOperatorSuppliers/);
  assert.match(gateway, /operator\/suppliers/);
  assert.match(route, /params\.action === 'products'/);
  assert.match(route, /params\.action === 'suppliers'/);
});