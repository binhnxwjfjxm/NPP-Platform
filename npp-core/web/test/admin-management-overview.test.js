import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('management overview reads existing Core data without adding mutation paths', async () => {
  const [page, gateway, dashboard] = await Promise.all([
    readSource('../app/management/page.tsx'),
    readSource('../lib/customer-onboarding-gateway.ts'),
    readSource('../app/dashboard/page.tsx'),
  ]);

  assert.match(page, /listSalesOrders/);
  assert.match(page, /listCustomerOnboardingRequests/);
  assert.match(page, /loadOrganizationSnapshot/);
  assert.match(page, /status: 'draft'/);
  assert.match(page, /'submitted', 'under_review', 'need_more_info'/);
  assert.match(page, /Màn hình này chỉ đọc dữ liệu/);
  assert.doesNotMatch(page, /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  assert.doesNotMatch(page, /DATABASE_URL|SELECT\s|INSERT\s|UPDATE\s|DELETE\s+FROM/i);

  assert.match(gateway, /import 'server-only'/);
  assert.match(gateway, /CORE_API_INTERNAL_URL/);
  assert.match(gateway, /CORE_API_SERVER_TOKEN/);
  assert.match(gateway, /Authorization: `Bearer \$\{requiredServerValue\('CORE_API_SERVER_TOKEN'\)\}`/);
  assert.match(gateway, /cache: 'no-store'/);
  assert.match(gateway, /AbortController/);
  assert.doesNotMatch(gateway, /console\.(?:log|error)|DATABASE_URL/);

  assert.match(dashboard, /title="Tổng quan cơ cấu"/);
  assert.doesNotMatch(dashboard, /management\/page/);
});

test('management overview remains usable on desktop and mobile', async () => {
  const [page, styles] = await Promise.all([
    readSource('../app/management/page.tsx'),
    readSource('../app/management/management.module.css'),
  ]);

  assert.match(page, /data-testid="management-overview-page"/);
  assert.match(page, /href="\/sales\/sales-orders"/);
  assert.match(page, /href="\/customers"/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 520px\)/);
  assert.match(styles, /grid-template-columns: 1fr/);
});
