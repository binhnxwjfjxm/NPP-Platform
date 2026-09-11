import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/inventory/manual-inbounds/manual-inbound-workspace.module.css', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../lib/manual-inbound-operator-gateway.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/inventory/manual-inbounds/operator/[action]/route.ts', import.meta.url), 'utf8');

test('Nhập kho thủ công chia 70/30 và giữ vùng nhập hàng là trọng tâm', () => {
  assert.match(css, /workspaceGrid\{[^}]*grid-template-columns:minmax\(0,7fr\) minmax\(300px,3fr\)/);
  assert.match(workspace, /className=\{styles\.entryColumn\}/);
  assert.match(workspace, /className=\{styles\.historyColumn\}/);
  assert.match(css, /productColumn\{[^}]*min-width:280px/);
  assert.match(css, /itemsCard\{min-height:520px/);
});

test('Thông tin chứng từ gọn và Ghi chú chỉ còn một dòng', () => {
  assert.match(workspace, /<AppShell title="Nhập kho thủ công" kicker="Kho">/);
  assert.doesNotMatch(workspace, /subtitle=/);
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

test('Web gateway có tìm hàng riêng cho Nhập kho thủ công', () => {
  assert.match(gateway, /searchManualInboundOperatorProducts/);
  assert.match(gateway, /operator\/products/);
  assert.match(route, /params\.action === 'products'/);
});
