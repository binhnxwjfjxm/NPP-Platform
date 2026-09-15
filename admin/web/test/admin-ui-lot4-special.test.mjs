import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Lô 4 keeps Tổng quan on shared toolbar, KPI and state primitives after local-first split', async () => {
  const [page, local, route, hook, css, interaction] = await Promise.all([
    read('app/page.tsx'),
    read('app/admin-overview-local.tsx'),
    read('app/api/local-read/admin-data/route.ts'),
    read('app/local-read/use-admin-local-read.ts'),
    read('app/overview.module.css'),
    read('app/admin-mobile-interaction.css'),
  ]);

  assert.match(page, /AdminOverviewLocal/);
  for (const name of ['AdminToolbar', 'AdminFilterChip', 'AdminKpiGrid', 'AdminKpiCard', 'AdminStatePanel', 'AdminStatusBadge']) {
    assert.match(local, new RegExp(`<${name}`));
  }
  assert.match(local, /label="Kỳ tổng quan"/);
  assert.match(local, /reportPeriods\.map/);
  assert.match(route, /loadControlTower\(resolveReportRange/);
  assert.match(route, /loadProposals\(\)/);
  assert.match(route, /loadAlertCenter\(period\)/);
  assert.match(hook, /createLocalReadCache/);
  assert.match(hook, /readLocalFirst/);
  assert.match(local, /const reportWarningFamilies = new Set\(data\?\.warnings\.map/);
  assert.match(local, /reportWarningFamilies\.forEach\(\(family\) => affectedSourceKeys\.add\(`report:\$\{family\}`\)\)/);
  assert.match(local, /value=\{affectedSourceCount\}/);
  assert.doesNotMatch(local, /label="Nguồn cần kiểm tra"[\s\S]{0,120}value=\{sourceWarnings\.length\}/);
  assert.doesNotMatch(local, /styles\.periodTabs|styles\.periodTab|styles\.periodActive|styles\.metricLink|overviewDecisionStrip/);
  assert.doesNotMatch(css, /\.periodTabs|\.periodTab|\.periodMeta|\.metricLink/);
  assert.doesNotMatch(interaction, /Kỳ tổng quan|Kỳ báo cáo|Lọc theo kho/);
});

test('Lô 4 keeps proposal decision behavior but moves the list onto local-first data', async () => {
  const [wrapper, list, detail, dialog] = await Promise.all([
    read('app/approvals/page.tsx'),
    read('app/approvals/approvals-local.tsx'),
    read('app/approvals/[approvalId]/page.tsx'),
    read('app/approvals/proposal-decision-dialog.tsx'),
  ]);

  assert.match(wrapper, /ApprovalsLocal/);
  assert.match(list, /useAdminLocalRead<ProposalItem\[]>\("proposals"\)/);
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
