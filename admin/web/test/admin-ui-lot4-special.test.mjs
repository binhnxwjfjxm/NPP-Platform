import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Lô 4 moves Tổng quan onto shared toolbar, KPI and state primitives', async () => {
  const [page, css, interaction] = await Promise.all([
    read('app/page.tsx'),
    read('app/overview.module.css'),
    read('app/admin-mobile-interaction.css'),
  ]);

  for (const name of ['AdminToolbar', 'AdminFilterChip', 'AdminKpiGrid', 'AdminKpiCard', 'AdminStatePanel', 'AdminStatusBadge']) {
    assert.match(page, new RegExp(`<${name}`));
  }
  assert.match(page, /label="Kỳ tổng quan"/);
  assert.match(page, /reportPeriods\.map/);
  assert.match(page, /loadControlTower\(range\)/);
  assert.match(page, /loadProposals\(\)/);
  assert.match(page, /loadAlertCenter\(period\)/);
  assert.doesNotMatch(page, /styles\.periodTabs|styles\.periodTab|styles\.periodActive|styles\.metricLink|overviewDecisionStrip/);
  assert.doesNotMatch(css, /\.periodTabs|\.periodTab|\.periodMeta|\.metricLink/);
  assert.doesNotMatch(interaction, /Kỳ tổng quan|Kỳ báo cáo|Lọc theo kho/);
});

test('Lô 4 keeps proposal decision behavior but migrates list and detail chrome', async () => {
  const [list, detail, dialog] = await Promise.all([
    read('app/approvals/page.tsx'),
    read('app/approvals/[approvalId]/page.tsx'),
    read('app/approvals/proposal-decision-dialog.tsx'),
  ]);

  for (const name of ['AdminKpiGrid', 'AdminKpiCard', 'AdminStatusBadge', 'AdminStatePanel']) assert.match(list, new RegExp(`<${name}`));
  assert.match(detail, /contentWidth="special"/);
  assert.match(detail, /AdminStatusBadge/);
  assert.match(detail, /AdminStatePanel/);
  assert.match(detail, /createIdempotencyKey\('admin-proposal-decision'\)/);
  assert.match(detail, /ProposalDecisionDialog/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /action=\{decideProposal\}/);
  assert.doesNotMatch(detail, /approvalDecisionBar|<textarea|action=\{decideProposal\}/);
});

test('Lô 4 uses neutral shared lifecycle action chrome for alert detail', async () => {
  const [detail, action, css] = await Promise.all([
    read('app/alerts/[alertId]/page.tsx'),
    read('app/alerts/actions.ts'),
    read('app/alerts/[alertId]/alert-detail.module.css'),
  ]);

  assert.match(detail, /contentWidth="special"/);
  assert.match(detail, /AdminStatusBadge/);
  assert.match(detail, /AdminStatePanel/);
  assert.match(detail, /AdminActionBar label="Cập nhật trạng thái cảnh báo"/);
  assert.match(detail, /createIdempotencyKey\('admin-alert-status'\)/);
  assert.match(detail, /new: \{ value: 'seen'/);
  assert.match(detail, /seen: \{ value: 'handling'/);
  assert.match(detail, /handling: \{ value: 'resolved'/);
  assert.match(action, /idempotencyKey/);
  assert.doesNotMatch(detail, /approvalDecisionBar|className="alertSeverity|className="alertStatus|className="card alertEmpty/);
  assert.match(css, /\.lifecycleButton/);
});
