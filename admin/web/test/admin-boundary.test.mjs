import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('admin keeps standalone frontend with shared Core backend and auth', async () => {
  const [pkg, vercel, core, middleware] = await Promise.all([read('package.json'), read('vercel.json'), read('lib/core-api.ts'), read('middleware.ts')]);
  assert.match(pkg, /admin-mcp-npp-web/); assert.match(vercel, /"deploymentEnabled"\s*:\s*false/); assert.match(core, /CORE_API_INTERNAL_URL/); assert.match(core, /employeeSessionToken/); assert.doesNotMatch(core, /CORE_API_SERVER_TOKEN|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/); assert.match(middleware, /\/api\/internal-auth\/me/);
});

test('admin shell exposes four management destinations and mobile icon-tab primitive', async () => {
  const [shell, tabs, css, overview] = await Promise.all([read('app/admin-shell.tsx'), read('app/admin-icon-tabs.tsx'), read('app/admin-management-shell.css'), read('app/page.tsx')]);
  for (const label of ['Tổng quan', 'Phê duyệt', 'Cảnh báo', 'Báo cáo']) assert.match(shell, new RegExp(label));
  assert.match(shell, /href: '\/approvals'/); assert.match(shell, /href: '\/alerts'/); assert.match(shell, /href: '\/reports'/); assert.doesNotMatch(shell, /NPP_OPERATIONS_URL|NPP Operations/); assert.doesNotMatch(shell, /label="Menu"|section: 'menu'/); assert.match(tabs, /adminIconTabs/); assert.match(tabs, /adminIconTabBadge/); assert.match(css, /repeat\(4,minmax\(0,1fr\)\)/); assert.match(overview, /href="\/approvals"/); assert.match(overview, /href="\/alerts"/); assert.match(overview, /href="\/reports"/); assert.doesNotMatch(overview, /NPP_OPERATIONS_URL|npp-platform\.vercel\.app/);
});

test('admin main module shells follow locked mobile taxonomy without fake mutations', async () => {
  const [approvals, alerts, reports] = await Promise.all([read('app/approvals/page.tsx'), read('app/alerts/page.tsx'), read('app/reports/page.tsx')]);
  for (const label of ['Tất cả','Thương mại','Khách hàng & công nợ','Kho','Giao vận & COD','MCP','Lịch sử']) assert.match(approvals,new RegExp(label.replace(/[&]/g,'\\&')));
  for (const label of ['Tổng hợp','Kinh doanh','Công nợ','Kho','Giao vận','MCP','Quy tắc','Lịch sử']) assert.match(alerts,new RegExp(label));
  for (const label of ['Điều hành','Kinh doanh & lợi nhuận','Công nợ','Kho','Giao vận & COD','MCP / thị trường','Nhân sự / hiệu suất','Phê duyệt & cảnh báo']) assert.match(reports,new RegExp(label.replace(/[\/]/g,'\\/')));
  assert.doesNotMatch(`${approvals}\n${alerts}\n${reports}`, /requestCore|fetch\(|POST|PUT|PATCH|DELETE|Idempotency-Key/);
});

test('approval center provides mobile prioritization, detail context and disabled integration actions', async () => {
  const [page, detail, fixtures, css] = await Promise.all([read('app/approvals/page.tsx'), read('app/approvals/[approvalId]/page.tsx'), read('app/approvals/approval-fixtures.ts'), read('app/admin-management-shell.css')]);
  assert.match(page,/Chờ quyết định/); assert.match(page,/Chờ bổ sung/); assert.match(page,/Ưu tiên cao/); assert.match(page,/approvalMetaGrid/); assert.match(page,/\/approvals\/\$\{item\.id\}/); assert.match(detail,/Lý do đề xuất/); assert.match(detail,/Quy tắc liên quan/); assert.match(detail,/Dữ liệu và bằng chứng/); assert.match(detail,/Lịch sử/); assert.match(detail,/Phê duyệt/); assert.match(detail,/Yêu cầu bổ sung/); assert.match(detail,/Từ chối/); assert.match(detail,/disabled/); assert.match(detail,/Chưa kết nối|chưa gửi yêu cầu tới backend/i); assert.match(fixtures,/source: 'Core'/); assert.match(fixtures,/source: 'MCP'/); assert.match(css,/\.approvalDecisionBar/); assert.doesNotMatch(`${page}\n${detail}\n${fixtures}`, /requestCore|fetch\(|method=['"]?(POST|PUT|PATCH|DELETE)|Idempotency-Key/);
});

test('alert center exposes rule-driven mobile monitoring without production mutations', async () => {
  const [page, detail, data, css] = await Promise.all([read('app/alerts/page.tsx'), read('app/alerts/[alertId]/page.tsx'), read('app/alerts/alert-preview-data.ts'), read('app/admin-management-shell.css')]);
  for (const label of ['Nghiêm trọng','Cao','Cần chú ý','Rule','Ngưỡng','Thực tế','Nguồn']) assert.match(`${page}\n${data}`, new RegExp(label));
  assert.match(page,/alertRuleList/); assert.match(page,/Dữ liệu dưới đây là dữ liệu mẫu frontend/); assert.match(detail,/Tín hiệu cảnh báo/); assert.match(detail,/Quy tắc liên quan/); assert.match(detail,/Hướng rà soát/); assert.match(detail,/Lịch sử tín hiệu/); assert.match(data,/source:'Core'/); assert.match(data,/source:'MCP'/); assert.match(css,/\.alertComparison/); assert.match(css,/\.alertSeverity\.is-critical/); assert.doesNotMatch(`${page}\n${detail}\n${data}`, /requestCore|fetch\(|method=['"]?(POST|PUT|PATCH|DELETE)|Idempotency-Key/);
});

test('management reports provide mobile KPI, period comparison and Core/MCP source context without production calls', async () => {
  const [page, detail, data, css] = await Promise.all([read('app/reports/page.tsx'), read('app/reports/[reportId]/page.tsx'), read('app/reports/report-preview-data.ts'), read('app/reports/report-center.module.css')]);
  for (const label of ['Hôm nay','7 ngày','Tháng này','Quý này','Kỳ hiện tại','Kỳ trước','Xu hướng kỳ','Nhận định quản trị']) assert.match(page,new RegExp(label));
  assert.match(page,/\/reports\/\$\{item\.id\}/); assert.match(page,/Dữ liệu dưới đây là dữ liệu mẫu frontend/); assert.match(detail,/Tóm tắt kỳ báo cáo/); assert.match(detail,/Chỉ số quản trị/); assert.match(detail,/Nguồn dữ liệu/); assert.match(data,/source:'Core'/); assert.match(data,/source:'MCP'/); assert.match(data,/source:'Core \+ MCP'/); assert.match(css,/\.sparkBars/); assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/); assert.doesNotMatch(`${page}\n${detail}\n${data}`, /requestCore|fetch\(|method=['"]?(POST|PUT|PATCH|DELETE)|Idempotency-Key/);
});

test('overview aggregates decision centers and mobile shell does not double-reserve bottom safe area', async () => {
  const [overview, css] = await Promise.all([read('app/page.tsx'), read('app/admin-management-shell.css')]);
  assert.match(overview, /approvalFixtures/); assert.match(overview, /adminAlerts/); assert.match(overview, /reportPreviews/);
  for (const label of ['Nhịp quản trị','Chờ phê duyệt','Cảnh báo mở','Ưu tiên hôm nay','Trung tâm quản trị']) assert.match(overview,new RegExp(label));
  assert.match(overview,/dữ liệu mẫu frontend/i); assert.match(overview,/overviewDecisionStrip/); assert.match(overview,/overviewFocusList/);
  assert.match(css,/grid-template-rows:auto minmax\(0,1fr\) auto/); assert.doesNotMatch(css,/grid-template-rows:auto minmax\(0,1fr\) calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css,/padding:5px 8px max\(5px,env\(safe-area-inset-bottom\)\)/); assert.match(css,/adminPageHeader h1\{font-size:1\.42rem/); assert.match(css,/\.adminBottomItem span\{font-size:\.58rem/);
});
