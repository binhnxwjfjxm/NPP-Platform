import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Admin AI usage stays inside Báo cáo instead of changing the owner-locked top navigation', async () => {
  const [shell, reports, aiPage] = await Promise.all([
    read('app/admin-shell.tsx'),
    read('app/reports/page.tsx'),
    read('app/reports/ai-usage/page.tsx'),
  ]);

  for (const label of ['Tổng quan', 'Đề xuất', 'Cảnh báo', 'Báo cáo']) {
    assert.match(shell, new RegExp(`label: '${label}'`));
  }
  assert.doesNotMatch(shell, /label: 'AI'|label: 'Trợ lý'/);
  assert.match(reports, /href: '\/reports\/ai-usage'/);
  assert.match(reports, /label: 'AI \/ tín dụng'/);
  assert.match(aiPage, /activeSection="reports"/);
});

test('Admin AI usage reads canonical Công Ty summary and event history server-side', async () => {
  const [gateway, aiPage] = await Promise.all([
    read('lib/ai-usage.ts'),
    read('app/reports/ai-usage/page.tsx'),
  ]);

  assert.match(gateway, /import 'server-only'/);
  assert.match(gateway, /requestCore<unknown>\(`\/api\/ai\/usage-summary/);
  assert.match(gateway, /requestCore<unknown>\(`\/api\/ai\/usage-events/);
  assert.doesNotMatch(gateway, /DATABASE_URL|postgres|supabase|fetch\(/i);
  assert.match(aiPage, /loadAiUsageSummary/);
  assert.match(aiPage, /loadAiUsageEvents/);
  assert.doesNotMatch(aiPage, /DATABASE_URL|postgres|supabase|fetch\(/i);
});

test('Admin AI usage exposes 1000 USD credit, filters and drill-down without profit language', async () => {
  const [aiPage, styles] = await Promise.all([
    read('app/reports/ai-usage/page.tsx'),
    read('app/reports/ai-usage/ai-usage.module.css'),
  ]);

  assert.match(aiPage, /hạn mức 1\.000 USD/i);
  assert.match(aiPage, /name="customerId"/);
  assert.match(aiPage, /name="source"/);
  assert.match(aiPage, /name="model"/);
  assert.match(aiPage, /Hôm nay/);
  assert.match(aiPage, /7 ngày/);
  assert.match(aiPage, /Tháng này/);
  assert.match(aiPage, /role="progressbar"/);
  assert.match(aiPage, /Đã sử dụng/);
  assert.match(aiPage, /Còn lại/);
  assert.match(aiPage, /Hạn mức/);
  assert.match(aiPage, /Trong kỳ/);
  assert.match(aiPage, /Token đầu vào/);
  assert.match(aiPage, /Token đầu ra/);
  assert.match(aiPage, /Tổng token/);
  assert.match(aiPage, /Chi tiết từng lượt/);
  assert.match(styles, /\.creditTrack/);
  assert.match(styles, /\.tableWrap/);
  assert.doesNotMatch(aiPage, /lợi nhuận|lãi AI|margin|revenue/i);
});

test('Admin AI usage keeps customer credit lifetime usage separate from period usage', async () => {
  const gateway = await read('lib/ai-usage.ts');

  assert.match(gateway, /periodUsageUsd/);
  assert.match(gateway, /usedUsd/);
  assert.match(gateway, /remainingUsd/);
  assert.match(gateway, /usagePercent/);
});
