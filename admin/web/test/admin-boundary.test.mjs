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
  const [shell, tabs, css, overview] = await Promise.all([read('app/admin-shell.tsx'), read('app/admin-icon-tabs.tsx'), read('app/admin-management-shell.css'), read('app/page.tsx')]);
  for (const label of ['Tổng quan', 'Đề xuất', 'Cảnh báo', 'Báo cáo']) assert.match(shell, new RegExp(label));
  assert.doesNotMatch(shell, /label: 'Phê duyệt'/);
  assert.equal((shell.match(/section: '(overview|approvals|alerts|reports)'/g) ?? []).length, 4);
  assert.match(shell, /href: '\/approvals'/); assert.match(shell, /href: '\/alerts'/); assert.match(shell, /href: '\/reports'/); assert.doesNotMatch(shell, /NPP_OPERATIONS_URL|NPP Operations/); assert.doesNotMatch(shell, /label="Menu"|section: 'menu'/); assert.match(tabs, /adminIconTabs/); assert.match(tabs, /adminIconTabBadge/); assert.match(css, /repeat\(4,minmax\(0,1fr\)\)/); assert.match(overview, /href="\/approvals"/); assert.match(overview, /href="\/alerts"/); assert.match(overview, /href="\/reports"/); assert.doesNotMatch(overview, /NPP_OPERATIONS_URL|npp-platform\.vercel\.app/);
});

test('admin main module shells keep management taxonomy without fake mutations', async () => {
  const [proposals, alerts, reports] = await Promise.all([read('app/approvals/page.tsx'), read('app/alerts/page.tsx'), read('app/reports/page.tsx')]);
  for (const label of ['Tất cả','Thương mại','Khách hàng & công nợ','Ngoại lệ vận hành','MCP','Lịch sử']) assert.match(proposals,new RegExp(label.replace(/[&]/g,'\\&')));
  assert.doesNotMatch(proposals, /label: 'Kho'|label: 'Giao vận & COD'/);
  for (const label of ['Tổng hợp','Kinh doanh','Công nợ','Kho','Giao vận','MCP','Quy tắc','Lịch sử']) assert.match(alerts,new RegExp(label));
  for (const label of ['Điều hành','Kinh doanh & lợi nhuận','Công nợ','Kho','Giao vận & COD','MCP / thị trường','Nhân sự / hiệu suất','Đề xuất & cảnh báo']) assert.match(reports,new RegExp(label.replace(/[\/]/g,'\\/')));
  assert.doesNotMatch(`${proposals}\n${alerts}\n${reports}`, /requestCore|fetch\(|POST|PUT|PATCH|DELETE|Idempotency-Key/);
});

test('proposal center provides management context and disabled future actions', async () => {
  const [page, detail, fixtures, css] = await Promise.all([read('app/approvals/page.tsx'), read('app/approvals/[approvalId]/page.tsx'), read('app/approvals/approval-fixtures.ts'), read('app/admin-management-shell.css')]);
  assert.match(page,/Trung tâm đề xuất/); assert.match(page,/Chờ quyết định/); assert.match(page,/Chờ bổ sung/); assert.match(page,/Ưu tiên cao/); assert.match(page,/approvalMetaGrid/); assert.match(page,/\/approvals\/\$\{item\.id\}/); assert.match(detail,/Lý do đề xuất/); assert.match(detail,/Điều kiện liên quan/); assert.match(detail,/Dữ liệu và bằng chứng/); assert.match(detail,/Lịch sử/); assert.match(detail,/Đồng ý/); assert.match(detail,/Yêu cầu bổ sung/); assert.match(detail,/Từ chối/); assert.match(detail,/disabled/); assert.match(fixtures,/source: 'Công Ty'/); assert.match(fixtures,/source: 'MCP'/); assert.doesNotMatch(fixtures,/domain: 'inventory'|domain: 'delivery-cod'|source: 'Core'/); assert.match(css,/\.approvalDecisionBar/); assert.doesNotMatch(`${page}\n${detail}\n${fixtures}`, /requestCore|fetch\(|method=['"]?(POST|PUT|PATCH|DELETE)|Idempotency-Key/);
});

test('alert center uses office language and Company/MCP lineage without production mutations', async () => {
  const [page, detail, data, css] = await Promise.all([read('app/alerts/page.tsx'), read('app/alerts/[alertId]/page.tsx'), read('app/alerts/alert-preview-data.ts'), read('app/admin-management-shell.css')]);
  for (const label of ['Nghiêm trọng','Cao','Cần chú ý','Quy tắc','Ngưỡng','Thực tế','Nguồn']) assert.match(`${page}\n${data}`, new RegExp(label));
  assert.match(page,/alertRuleList/); assert.match(page,/Dữ liệu minh họa/); assert.match(detail,/Tín hiệu cảnh báo/); assert.match(detail,/Quy tắc liên quan/); assert.match(detail,/Hướng rà soát/); assert.match(detail,/Lịch sử tín hiệu/); assert.match(data,/source:'Công Ty'/); assert.match(data,/source:'MCP'/); assert.doesNotMatch(`${page}\n${detail}`, /frontend|backend|production|Stage|Mã rule|Tên rule|Rule đang/i); assert.match(css,/\.alertComparison/); assert.match(css,/\.alertSeverity\.is-critical/); assert.doesNotMatch(`${page}\n${detail}\n${data}`, /requestCore|fetch\(|method=['"]?(POST|PUT|PATCH|DELETE)|Idempotency-Key/);
});

test('management reports use office language and server-side Company/MCP reporting sources', async () => {
  const [page, detail, data, css] = await Promise.all([read('app/reports/page.tsx'), read('app/reports/[reportId]/page.tsx'), read('app/reports/report-data.ts'), read('app/reports/report-center.module.css')]);
  for (const label of ['Hôm nay','7 ngày','Tháng này','Quý này','Xu hướng kỳ','Diễn biến từ số liệu thật','Điểm cần chú ý']) assert.match(page,new RegExp(label));
  assert.match(page,/\/reports\/\$\{item\.id\}/); assert.doesNotMatch(page,/Dữ liệu minh họa|report-preview-data/); assert.match(detail,/Phạm vi số liệu/); assert.match(detail,/Chỉ số quản trị/); assert.match(detail,/Nguồn số liệu/); assert.match(data,/Công Ty/); assert.match(data,/MCP/); assert.match(data,/requestCore/); assert.match(data,/server-only/); assert.doesNotMatch(`${page}\n${detail}`, /frontend|backend|production|contract|phase/i); assert.match(css,/\.sparkBars/); assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/); assert.doesNotMatch(`${page}\n${detail}\n${data}`, /method=['"]?(POST|PUT|PATCH|DELETE)|Idempotency-Key/);
});

test('overview aggregates proposal, alert and live report centers with office wording', async () => {
  const [overview, css] = await Promise.all([read('app/page.tsx'), read('app/admin-management-shell.css')]);
  assert.match(overview, /approvalFixtures/); assert.match(overview, /adminAlerts/); assert.match(overview, /loadControlTower/); assert.match(overview, /executiveReportState/); assert.doesNotMatch(overview, /reportPreviews|reports\/report-preview-data/);
  for (const label of ['Nhịp quản trị','Chờ quyết định','Cảnh báo mở','Ưu tiên hôm nay','Trung tâm quản trị','Đề xuất','Số liệu Công Ty']) assert.match(overview,new RegExp(label));
  assert.doesNotMatch(overview,/Phê duyệt|dữ liệu mẫu frontend/i); assert.match(overview,/overviewDecisionStrip/); assert.match(overview,/overviewFocusList/);
  assert.match(css,/grid-template-rows:auto minmax\(0,1fr\) auto/); assert.doesNotMatch(css,/grid-template-rows:auto minmax\(0,1fr\) calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css,/padding:5px 8px max\(5px,env\(safe-area-inset-bottom\)\)/); assert.match(css,/adminPageHeader h1\{font-size:1\.42rem/); assert.match(css,/\.adminBottomItem span\{font-size:\.58rem/);
});