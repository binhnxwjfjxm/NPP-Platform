import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Lô 5 closes visible Admin identity and keeps the four-section management navigation', async () => {
  const [shell, layout, manifest, login, offline, deployWorkflow] = await Promise.all([
    read('app/admin-shell.tsx'),
    read('app/layout.tsx'),
    read('app/manifest.ts'),
    read('app/login/page.tsx'),
    read('public/offline.html'),
    read('../../.github/workflows/vercel-admin-production-manual.yml'),
  ]);

  for (const source of [shell, layout, manifest, login, offline]) assert.match(source, /Admin Hưng Phát/);
  for (const label of ['Tổng quan', 'Đề xuất', 'Cảnh báo', 'Báo cáo']) assert.match(shell, new RegExp(`label: '${label}'`));

  assert.doesNotMatch(shell, /Admin MCP\/NPP/);
  assert.doesNotMatch(layout, /Admin MCP\/NPP/);
  assert.doesNotMatch(manifest, /Admin MCP\/NPP/);
  assert.doesNotMatch(offline, /Admin MCP\/NPP/);
  assert.match(login, /<strong>Admin Hưng Phát<\/strong>/);
  assert.equal((login.match(/Admin MCP\/NPP/g) ?? []).length, 1, 'legacy text may remain only as the technical production smoke marker');
  assert.match(login, /data-admin-smoke-marker="Admin MCP\/NPP"/);
  assert.match(deployWorkflow, /grep -Fq 'Admin MCP\/NPP'/);
});

test('Lô 5 keeps one shared layout system and the final mobile interaction boundary', async () => {
  const [layout, tabs, primitives, interaction] = await Promise.all([
    read('app/layout.tsx'),
    read('app/admin-icon-tabs.tsx'),
    read('app/admin-ui-primitives.tsx'),
    read('app/admin-mobile-interaction.css'),
  ]);

  for (const name of ['AdminToolbar', 'AdminFilterChip', 'AdminStatusBadge', 'AdminKpiGrid', 'AdminKpiCard', 'AdminStatePanel', 'AdminActionBar']) {
    assert.match(primitives, new RegExp(`export function ${name}`));
  }
  assert.match(tabs, /data-admin-tabs/);
  assert.match(tabs, /aria-current=\{tab\.active \? 'page' : undefined\}/);
  assert.match(tabs, /adminIconTabGlyph/);
  assert.match(tabs, /adminIconTabLabel/);

  const foundationIndex = layout.indexOf("import './admin-foundation.css'");
  const closeoutIndex = layout.indexOf("import './admin-closeout.css'");
  const interactionIndex = layout.indexOf("import './admin-mobile-interaction.css'");
  assert.ok(foundationIndex >= 0 && closeoutIndex > foundationIndex && interactionIndex > closeoutIndex, 'final mobile constraints must load after shared visual layers');

  assert.match(layout, /maximumScale:\s*1/);
  assert.match(layout, /userScalable:\s*false/);
  assert.match(interaction, /\.adminAppShell,[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%/);
  assert.match(interaction, /\.adminIconTabs[\s\S]*overflow-x:\s*auto;[\s\S]*touch-action:\s*pan-x/);
  assert.match(interaction, /html,[\s\S]*body[\s\S]*touch-action:\s*pan-x pan-y/);
  assert.doesNotMatch(interaction, /pinch-zoom/);
});

test('Lô 5 preserves proposal, alert, report and MCP management contracts', async () => {
  const [proposalDetail, proposalDialog, alertDetail, reports, mcpRegression] = await Promise.all([
    read('app/approvals/[approvalId]/page.tsx'),
    read('app/approvals/proposal-decision-dialog.tsx'),
    read('app/alerts/[alertId]/page.tsx'),
    read('app/reports/page.tsx'),
    read('test/mcp-supervision-ux.test.mjs'),
  ]);

  assert.match(proposalDetail, /createIdempotencyKey\('admin-proposal-decision'\)/);
  assert.match(proposalDetail, /<ProposalDecisionDialog/);
  assert.match(proposalDialog, /showModal\(\)/);
  assert.match(proposalDialog, /action=\{decideProposal\}/);
  assert.match(proposalDialog, /Yêu cầu bổ sung/);

  assert.match(alertDetail, /createIdempotencyKey\('admin-alert-status'\)/);
  assert.match(alertDetail, /new: \{ value: 'seen'/);
  assert.match(alertDetail, /seen: \{ value: 'handling'/);
  assert.match(alertDetail, /handling: \{ value: 'resolved'/);
  assert.match(alertDetail, /AdminActionBar label="Cập nhật trạng thái cảnh báo"/);

  for (const name of ['AdminIconTabs', 'AdminToolbar', 'AdminFilterChip', 'AdminStatePanel', 'AdminKpiGrid', 'AdminKpiCard']) assert.match(reports, new RegExp(`<${name}`));
  assert.match(reports, /Xuất báo cáo Excel/);
  assert.match(reports, /Theo dõi số liệu quản trị từ Công Ty và MCP/);
  assert.match(reports, /state === 'error'/);
  assert.match(reports, /state === 'forbidden'/);

  assert.match(mcpRegression, /const PAGE_SIZE = 25/);
  assert.match(mcpRegression, /name="q"/);
  assert.match(mcpRegression, /name="status"/);
  assert.match(mcpRegression, /remains read-only/);
  assert.match(mcpRegression, /does not invent unsupported realtime facts/);
});

test('Lô 5 keeps explicit loading, error and not-found states instead of silent zero fallbacks', async () => {
  const [loading, error, notFound] = await Promise.all([
    read('app/loading.tsx'),
    read('app/error.tsx'),
    read('app/not-found.tsx'),
  ]);

  assert.match(loading, /Đang tải dữ liệu/);
  assert.match(loading, /role="status"/);
  assert.match(error, /Không thể mở nội dung/);
  assert.match(error, /Dữ liệu đang không sẵn sàng/);
  assert.match(error, /role="alert"/);
  assert.match(notFound, /Không tìm thấy nội dung cần xem/);
  assert.match(notFound, /Về Tổng quan/);
});
