import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('Lô 7 keeps signed-out and deep-link access fail-closed with office wording', async () => {
  const [middleware, login, menu, coreApi, internalAuth, shell] = await Promise.all([
    read('middleware.ts'),
    read('app/login/page.tsx'),
    read('app/menu/page.tsx'),
    read('lib/core-api.ts'),
    read('lib/internal-auth-client.ts'),
    read('app/admin-shell.tsx'),
  ]);

  assert.match(middleware, /loginRedirect\(request\)/);
  assert.match(middleware, /safeAdminReturnTo/);
  assert.match(middleware, /\/api\/internal-auth\/me/);
  assert.match(middleware, /deny\(request, 401/);
  assert.match(middleware, /deny\(request, 503/);
  assert.match(middleware, /matcher:/);
  assert.match(login, /Hệ thống Công Ty tạm thời chưa sẵn sàng/);
  assert.match(menu, /hệ thống Công Ty/);
  assert.match(shell, /alt="Logo Hưng Phát"/);

  const userFacing = `${middleware}\n${login}\n${menu}\n${coreApi}\n${internalAuth}\n${shell}`;
  assert.doesNotMatch(userFacing, /NPP Core|Backend hiện|contract xác minh|cookie HttpOnly|Security\/Implementation Owner|hệ thống Core|Hưng Phát Company/);
});

test('Lô 7 distinguishes forbidden unavailable and empty states without fake zero counts', async () => {
  const [proposalList, proposalDetail, alertList, alertDetail] = await Promise.all([
    read('app/approvals/page.tsx'),
    read('app/approvals/[approvalId]/page.tsx'),
    read('app/alerts/page.tsx'),
    read('app/alerts/[alertId]/page.tsx'),
  ]);

  assert.match(proposalList, /statusCode === 403/);
  assert.match(proposalList, /không có quyền xem đề xuất quản trị/);
  assert.match(proposalDetail, /statusCode === 403/);
  assert.match(proposalDetail, /không có quyền xem đề xuất quản trị/);

  assert.match(alertList, /data\.domainAccess\[selectedDomain\]/);
  assert.match(alertList, /!selectedAccess\.available/);
  assert.match(alertList, /Chưa thể mở nhóm cảnh báo này/);
  assert.doesNotMatch(alertList, /unavailableTabs/);
  assert.doesNotMatch(alertList, /badge:'0'|badge: '0'/);
  assert.match(alertList, /activeAlerts \? activeAlerts\.length : '—'/);
  assert.match(alertList, /sourceReady \? data\.rules\.length : '—'/);

  const messageBranch = alertDetail.indexOf('if (!alert && data.message)');
  const notFoundBranch = alertDetail.indexOf('if (!alert) notFound()');
  assert.ok(messageBranch >= 0 && notFoundBranch > messageBranch, 'source/permission errors must be handled before genuine 404');
});

test('Lô 7 decision reporting uses real proposal and alert sources', async () => {
  const data = await read('app/reports/report-data.ts');
  assert.match(data, /source: 'Đề xuất và cảnh báo quản trị của Công Ty'/);
  assert.match(data, /loadSource\('\/api\/management-proposals'\)/);
  assert.match(data, /loadSource\(withRange\('\/api\/reporting\/admin-alerts'/);
  assert.match(data, /buildDecisions\(range, proposals, alerts\)/);
  assert.match(data, /proposalSource\.ok \? String\(pending\) : 'Chưa có dữ liệu'/);
  assert.match(data, /alertSource\.ok \? String\(openAlerts\) : 'Chưa có dữ liệu'/);
  assert.doesNotMatch(data, /source: 'Chưa có nguồn đề xuất chính thức'|Chưa có nguồn đề xuất và cảnh báo chính thức/);
});

test('Lô 7 preserves Overview detail back-flow with a safe internal return target', async () => {
  const [overview, detail, session] = await Promise.all([
    read('app/page.tsx'),
    read('app/reports/[reportId]/page.tsx'),
    read('lib/admin-session.ts'),
  ]);
  assert.match(overview, /new URLSearchParams\(\{ period, returnTo: overviewHref\(period\) \}\)/);
  assert.match(detail, /safeAdminReturnTo\(returnTo\)/);
  assert.match(detail, /Quay lại Tổng quan/);
  assert.match(detail, /safeReturnTo\.startsWith\('\/\?period='\)/);
  assert.match(session, /!candidate\.startsWith\('\/\/'\)/);
});

test('Lô 7 provides loading error not-found mobile and keyboard states', async () => {
  const [layout, loading, errorPage, notFound, closeoutCss, focusCss] = await Promise.all([
    read('app/layout.tsx'),
    read('app/loading.tsx'),
    read('app/error.tsx'),
    read('app/not-found.tsx'),
    read('app/admin-closeout.css'),
    read('app/hung-phat-warm-gold.css'),
  ]);
  assert.match(layout, /admin-closeout\.css/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-live="polite"/);
  assert.match(errorPage, /role="alert"/);
  assert.match(errorPage, /Thử lại/);
  assert.doesNotMatch(errorPage, /error\.message|error\.stack|digest/);
  assert.match(notFound, /Không tìm thấy nội dung/);
  assert.match(notFound, /Về Tổng quan/);
  assert.match(closeoutCss, /@media\s*\(max-width:\s*430px\)/);
  assert.doesNotMatch(closeoutCss, /\.approvalDecisionBar/);
  assert.match(closeoutCss, /\.adminRouteStateAction\s*\{[\s\S]*min-height:\s*44px/);
  assert.match(closeoutCss, /\.alertComparison\s*\{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(focusCss, /button:focus-visible/);
  assert.match(focusCss, /a:focus-visible/);
  assert.match(focusCss, /summary:focus-visible/);
  assert.match(focusCss, /prefers-reduced-motion/);
});

test('Lô 7 connected Admin screens do not import preview fixtures', async () => {
  const files = await Promise.all([
    read('app/page.tsx'),
    read('app/approvals/page.tsx'),
    read('app/approvals/[approvalId]/page.tsx'),
    read('app/alerts/page.tsx'),
    read('app/alerts/[alertId]/page.tsx'),
    read('app/reports/page.tsx'),
    read('app/reports/[reportId]/page.tsx'),
    read('app/reports/report-data.ts'),
  ]);
  assert.doesNotMatch(files.join('\n'), /report-preview-data|alert-preview-data|approvalFixtures|adminPreviewNotice|Dữ liệu minh họa/);
});
