import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('admin keeps standalone frontend with shared Core backend and auth', async () => {
  const [pkg, vercel, core, middleware] = await Promise.all([read('package.json'), read('vercel.json'), read('lib/core-api.ts'), read('middleware.ts')]);
  assert.match(pkg, /admin-mcp-npp-web/); assert.match(vercel, /"deploymentEnabled"\s*:\s*false/); assert.match(core, /CORE_API_INTERNAL_URL/); assert.match(core, /employeeSessionToken/); assert.doesNotMatch(core, /CORE_API_SERVER_TOKEN|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/); assert.match(middleware, /\/api\/internal-auth\/me/);
});

test('admin shell exposes exactly four management destinations with proposal wording', async () => {
  const [shell, tabs, managementCss, overview, mobileApp, foundation] = await Promise.all([
    read('app/admin-shell.tsx'),
    read('app/admin-icon-tabs.tsx'),
    read('app/admin-management-shell.css'),
    read('app/page.tsx'),
    read('app/admin-mobile-app.css'),
    read('app/admin-foundation.css'),
  ]);
  for (const label of ['Tổng quan', 'Đề xuất', 'Cảnh báo', 'Báo cáo']) assert.match(shell, new RegExp(label));
  assert.doesNotMatch(shell, /label: 'Phê duyệt'/);
  assert.equal((shell.match(/section: '(overview|approvals|alerts|reports)'/g) ?? []).length, 4);
  assert.match(shell, /href: '\/approvals'/); assert.match(shell, /href: '\/alerts'/); assert.match(shell, /href: '\/reports'/); assert.doesNotMatch(shell, /NPP_OPERATIONS_URL|NPP Operations/); assert.doesNotMatch(shell, /label="Menu"|section: 'menu'/);
  assert.match(tabs, /adminIconTabs/); assert.match(tabs, /adminIconTabBadge/);
  assert.match(mobileApp, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(managementCss, /\.adminIconTabs|\.adminIconTab\b/);
  assert.match(foundation, /\.adminIconTabs/);
  assert.match(overview, /href="\/approvals"/); assert.match(overview, /href="\/alerts"/); assert.match(overview, /href="\/reports"/); assert.doesNotMatch(overview, /NPP_OPERATIONS_URL|npp-platform\.vercel\.app/);
});

test('admin main module shells keep management taxonomy without fake mutations', async () => {
  const [proposals, alerts, reports] = await Promise.all([read('app/approvals/page.tsx'), read('app/alerts/page.tsx'), read('app/reports/page.tsx')]);
  for (const label of ['Tất cả','Thương mại','Khách hàng & công nợ','Ngoại lệ vận hành','MCP','Lịch sử']) assert.match(proposals,new RegExp(label.replace(/[&]/g,'\\&')));
  assert.doesNotMatch(proposals, /label: 'Kho'|label: 'Giao vận & COD'/);
  for (const label of ['Tổng hợp','Kinh doanh','Công nợ','Kho','Giao vận','MCP','Quy tắc','Lịch sử']) assert.match(alerts,new RegExp(label));
  for (const label of ['Điều hành','Kinh doanh & lợi nhuận','Công nợ','Kho','Giao vận & COD','MCP / thị trường','Nhân sự / hiệu suất','Đề xuất & cảnh báo']) assert.match(reports,new RegExp(label.replace(/[\/]/g,'\\/')));
  assert.doesNotMatch(`${proposals}\n${alerts}\n${reports}`, /requestCore|fetch\(|POST|PUT|PATCH|DELETE|Idempotency-Key/);
});

test('proposal center keeps reading separate from the decision dialog', async () => {
  const [page, detail, dialog, dialogCss, fixtures] = await Promise.all([
    read('app/approvals/page.tsx'),
    read('app/approvals/[approvalId]/page.tsx'),
    read('app/approvals/proposal-decision-dialog.tsx'),
    read('app/approvals/proposal-decision-dialog.module.css'),
    read('app/approvals/approval-fixtures.ts'),
  ]);
  assert.match(page,/Trung tâm đề xuất/); assert.match(page,/Chờ quyết định/); assert.match(page,/Chờ bổ sung/); assert.match(page,/Ưu tiên cao/); assert.match(page,/approvalMetaGrid/); assert.match(page,/\/approvals\/\$\{item\.id\}/);
  assert.match(detail,/Lý do \/ bối cảnh/); assert.match(detail,/Điều kiện cần lưu ý/); assert.match(detail,/Dữ liệu và bằng chứng/); assert.match(detail,/item\.reason \?/); assert.match(detail,/item\.rule \?/); assert.match(detail,/item\.evidence\.length \?/); assert.match(detail,/hasRelatedEntity \?/); assert.match(detail,/Lịch sử/); assert.match(detail,/ProposalDecisionDialog/); assert.doesNotMatch(detail,/approvalDecisionBar|<textarea|action=\{decideProposal\}/);
  for (const label of ['Xem xét đề xuất','Đồng ý','Yêu cầu bổ sung','Từ chối','Ghi chú quyết định','Hủy']) assert.match(dialog,new RegExp(label));
  assert.match(dialog,/showModal\(\)/); assert.match(dialog,/action=\{decideProposal\}/); assert.match(dialog,/aria-pressed/); assert.match(dialog,/required=\{noteRequired\}/); assert.match(dialog,/disabled=\{!decision\}/); assert.match(dialog,/Xác nhận đồng ý/); assert.match(dialog,/Gửi yêu cầu bổ sung/); assert.match(dialog,/Xác nhận từ chối/);
  assert.match(dialogCss,/\.dialog::backdrop/); assert.match(dialogCss,/\.decisionGrid/); assert.match(dialogCss,/@media \(max-width: 640px\)/);
  assert.match(fixtures,/source: 'Công Ty'/); assert.match(fixtures,/source: 'MCP'/); assert.doesNotMatch(fixtures,/domain: 'inventory'|domain: 'delivery-cod'|source: 'Core'/);
  assert.doesNotMatch(`${page}\n${detail}\n${dialog}\n${fixtures}`, /requestCore|fetch\(|method=['"]?(POST|PUT|PATCH|DELETE)|Idempotency-Key/);
});

test('alert center uses live multi-domain data, canonical lifecycle and office language', async () => {
  const [page, detail, data, action, css] = await Promise.all([read('app/alerts/page.tsx'), read('app/alerts/[alertId]/page.tsx'), read('app/alerts/alert-data.ts'), read('app/alerts/actions.ts'), read('app/admin-management-shell.css')]);
  for (const label of ['Nghiêm trọng','Cao','Cần chú ý','Quy tắc','Điều kiện','Dữ liệu ghi nhận','Nguồn']) assert.match(page, new RegExp(label));
  for (const label of ['Mới','Đã xem','Đang xử lý','Đã giải quyết']) assert.match(`${page}\n${detail}`, new RegExp(label));
  assert.match(page,/alertRuleList/); assert.match(detail,/Tín hiệu cảnh báo/); assert.match(detail,/Bằng chứng hiện có/); assert.match(detail,/Hướng rà soát/); assert.match(detail,/Lịch sử xử lý/); assert.match(detail,/AdminActionBar/); assert.match(detail,/AdminStatusBadge/); assert.doesNotMatch(detail,/approvalDecisionBar/); assert.match(data,/\/api\/reporting\/admin-alerts/); assert.match(data,/server-only/); assert.match(data,/domainAccess/); assert.match(action,/idempotencyKey/); assert.match(action,/method: 'POST'/); assert.match(css,/\.alertComparison/); assert.doesNotMatch(`${page}\n${detail}`, /alert-preview-data|Dữ liệu minh họa|frontend|backend|production|Stage|Mã rule|Tên rule|Rule đang/i);
});

test('management reports use office language and server-side Company/MCP reporting sources', async () => {
  const [page, detail, data, css] = await Promise.all([read('app/reports/page.tsx'), read('app/reports/[reportId]/page.tsx'), read('app/reports/report-data.ts'), read('app/reports/report-center.module.css')]);
  for (const label of ['Hôm nay','7 ngày','Tháng này','Quý này']) assert.match(data,new RegExp(label));
  for (const label of ['Xu hướng kỳ','Diễn biến từ số liệu thật','Điểm cần chú ý']) assert.match(page,new RegExp(label));
  assert.match(page,/\/reports\/\$\{item\.id\}/); assert.doesNotMatch(page,/Dữ liệu minh họa|report-preview-data/); assert.match(detail,/Phạm vi số liệu/); assert.match(detail,/Chỉ số quản trị/); assert.match(detail,/Nguồn số liệu/); assert.match(data,/Công Ty/); assert.match(data,/MCP/); assert.match(data,/requestCore/); assert.match(data,/server-only/); assert.doesNotMatch(`${page}\n${detail}`, /frontend|backend|production|contract|phase/i); assert.match(css,/\.sparkBars/); assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/); assert.doesNotMatch(`${page}\n${detail}\n${data}`, /method=['"]?(POST|PUT|PATCH|DELETE)|Idempotency-Key/);
});

test('overview uses live proposal alert and reporting sources with shared management layout', async () => {
  const [overview, controlTower, managementCss, overviewCss, mobileApp, foundation] = await Promise.all([
    read('app/page.tsx'),
    read('lib/control-tower.ts'),
    read('app/admin-management-shell.css'),
    read('app/overview.module.css'),
    read('app/admin-mobile-app.css'),
    read('app/admin-foundation.css'),
  ]);
  assert.match(overview, /loadProposals/); assert.match(overview, /loadAlertCenter/); assert.match(overview, /loadControlTower\(range\)/); assert.match(overview, /reportPeriods\.map/); assert.match(overview, /resolveReportRange/); assert.match(overview, /executiveReportState/);
  for (const primitive of ['AdminToolbar','AdminFilterChip','AdminKpiGrid','AdminKpiCard','AdminStatePanel','AdminStatusBadge']) assert.match(overview, new RegExp(`<${primitive}`));
  assert.doesNotMatch(overview, /approvalFixtures|adminAlerts|alert-preview-data|approval-fixtures|Dữ liệu minh họa|adminPreviewNotice/);
  assert.match(controlTower, /URLSearchParams/); assert.match(controlTower, /\/api\/reporting\/control-tower\?/);
  for (const label of ['Nhịp quản trị','Chờ quyết định','Cảnh báo mở','Ưu tiên hôm nay','Đề xuất','Số liệu Công Ty']) assert.match(overview,new RegExp(label));
  assert.doesNotMatch(overview, /Trung tâm quản trị|adminOverviewActions|adminOverviewAction/);
  assert.match(overview,/chờ bổ sung/i);
  for (const reportId of ['sales-profit-summary','inventory-overview','delivery-cod-overview']) assert.match(overview,new RegExp(reportId));
  assert.match(overview, /proposals === null/); assert.match(overview, /alertData\.message/); assert.match(overview, /Một số số liệu chưa đầy đủ/); assert.match(overview, /Không có việc ưu tiên đang mở/);
  assert.doesNotMatch(overview,/Phê duyệt|dữ liệu mẫu frontend|backend|production|contract|phase/i); assert.doesNotMatch(overview,/overviewDecisionStrip|styles\.periodTabs|styles\.metricLink/); assert.match(overview,/overviewFocusList/);
  assert.doesNotMatch(overviewCss,/\.periodTabs|\.metricLink|\.periodMeta/); assert.match(overviewCss,/\.sourceState/); assert.match(overviewCss,/\.focusState/);
  assert.match(mobileApp,/grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/); assert.doesNotMatch(mobileApp,/grid-template-rows:\s*auto minmax\(0,\s*1fr\) calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileApp,/padding:\s*5px 8px max\(5px,\s*env\(safe-area-inset-bottom\)\)/);
  assert.match(foundation,/\.adminPageHeader h1 \{ font-size: 1\.42rem; \}/); assert.match(foundation,/\.adminBottomItem span \{ font-size: \.68rem; \}/);
  assert.doesNotMatch(managementCss, /adminOverviewActions|adminOverviewAction/);
});
