import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('customer onboarding review uses the existing protected workflow', async () => {
  const [gateway, route, middleware, page, workspace, overview] = await Promise.all([
    readSource('../lib/customer-onboarding-gateway.ts'),
    readSource('../app/api/customer-onboarding-requests/[id]/[action]/route.ts'),
    readSource('../middleware.ts'),
    readSource('../app/management/customer-onboarding/page.tsx'),
    readSource('../app/management/customer-onboarding/customer-onboarding-review.tsx'),
    readSource('../app/management/page.tsx'),
  ]);

  assert.match(gateway, /import 'server-only'/);
  assert.match(gateway, /ALLOWED_ACTIONS/);
  assert.match(gateway, /'need-more-info'/);
  assert.match(gateway, /'link-existing'/);
  assert.match(gateway, /isPositiveInteger\(value\.version\)/);
  assert.match(gateway, /query\.set\('offset'/);
  assert.match(gateway, /Idempotency-Key/);
  assert.match(gateway, /CORE_API_SERVER_TOKEN/);
  assert.match(gateway, /cache: 'no-store'/);
  assert.doesNotMatch(gateway, /DATABASE_URL|console\.(?:log|error)/);

  assert.match(route, /mutateCustomerOnboardingRequest/);
  assert.match(route, /request\.headers\.get\('idempotency-key'\)/);
  assert.match(route, /isSameOriginRequest/);
  assert.match(route, /sec-fetch-site/);
  assert.match(route, /contentType !== 'application\/json'/);
  assert.match(route, /safeConflictDetails/);
  assert.match(route, /'expectedVersion', 'currentVersion'/);
  assert.match(route, /Cache-Control': 'no-store'/);
  assert.match(middleware, /'\/api\/customer-onboarding-requests\/:path\*'/);

  assert.match(page, /loadAllRequestsForStatus/);
  assert.match(page, /offset \+= ONBOARDING_PAGE_SIZE/);
  assert.match(page, /offset \+= CUSTOMER_PAGE_SIZE/);
  assert.match(page, /added === 0/);
  assert.match(page, /'submitted', 'under_review', 'need_more_info'/);
  assert.match(page, /active: 'true'/);
  assert.match(page, /CustomerOnboardingReview/);
  assert.match(overview, /href="\/management\/customer-onboarding"/);

  assert.match(workspace, /expectedVersion: request\.version/);
  assert.match(workspace, /stableActionKey/);
  assert.match(workspace, /busyRequests\.current\.has\(request\.id\)/);
  assert.match(workspace, /busyByRequest\[request\.id\] === true/);
  assert.match(workspace, /response\.status < 500/);
  assert.match(workspace, /payload\?\.error\?\.retryable !== true/);
  assert.match(workspace, /delete actionKeys\.current\[idempotency\.cacheKey\]/);
  assert.match(workspace, /addressRequestVersions/);
  assert.match(workspace, /addressRequestVersions\.current\[requestId\] !== requestVersion/);
  assert.match(workspace, /Bắt đầu xem xét/);
  assert.match(workspace, /Yêu cầu bổ sung/);
  assert.match(workspace, /Duyệt tạo khách mới/);
  assert.match(workspace, /Liên kết khách đã có/);
  assert.match(workspace, /Từ chối/);
  assert.match(workspace, /router\.refresh\(\)/);
  assert.doesNotMatch(workspace, /CORE_API_SERVER_TOKEN|DATABASE_URL|Authorization/);
});

test('review screen remains usable on desktop and mobile', async () => {
  const [workspace, styles] = await Promise.all([
    readSource('../app/management/customer-onboarding/customer-onboarding-review.tsx'),
    readSource('../app/management/customer-onboarding/customer-onboarding-review.module.css'),
  ]);

  assert.match(workspace, /data-testid="customer-onboarding-review-workspace"/);
  assert.match(workspace, /maxLength=\{64\}/);
  assert.match(workspace, /maxLength=\{2000\}/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /width: 100%/);
});
