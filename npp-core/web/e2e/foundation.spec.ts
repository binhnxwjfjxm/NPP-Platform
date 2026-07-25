import { test, expect } from '@playwright/test';

const TEST_TOKEN_MARKER = process.env.E2E_BACKEND_API_TOKEN ?? '';
const TEST_DATABASE_MARKER = process.env.E2E_DATABASE_URL ?? '';

function expectNoSensitiveData(value: string) {
  expect(value).not.toContain('Authorization');
  expect(value).not.toContain('CORE_API_SERVER_TOKEN');
  expect(value).not.toContain('CORE_API_INTERNAL_URL');
  expect(value).not.toContain('postgresql://');
  expect(value).not.toContain('r2.cloudflarestorage.com');
  expect(value).not.toContain('X-Amz-Signature');
  if (TEST_TOKEN_MARKER) expect(value).not.toContain(TEST_TOKEN_MARKER);
  if (TEST_DATABASE_MARKER) expect(value).not.toContain(TEST_DATABASE_MARKER);
}

test.describe('Foundation UI enabled', () => {
  test('renders the readiness dashboard with actual Core API state', async ({ page }) => {
    const response = await page.goto('/foundation');
    expect(response?.status()).toBe(200);

    await expect(page.getByRole('heading', { name: 'NPP Platform readiness' })).toBeVisible();
    await expect(page.getByText('Operational', { exact: true })).toBeVisible();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await expect(page.getByTestId('actor-id')).toHaveText('bootstrap:e2e');
    await expect(page.getByTestId('installation-id')).toHaveText('e2e-installation');
    await expect(page.getByTestId('source-app')).toHaveText('npp-core-api');
    await expect(page.getByText('Adapter disabled', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Run R2 contract test/i })).toHaveCount(0);
  });

  test('refresh control re-runs the safe status gateway', async ({ page }) => {
    await page.goto('/foundation');
    const refresh = page.getByRole('button', { name: 'Refresh' });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await expect(page.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    await expect(page.getByTestId('last-checked')).not.toContainText('Not checked yet');
  });

  test('status response is sanitized and server-owned', async ({ request }) => {
    const response = await request.get('/api/foundation/status', {
      headers: {
        'x-actor-id': 'spoofed-actor',
        'x-installation-id': 'spoofed-installation',
        'x-source-app': 'spoofed-app',
      },
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(payload.apiLive).toBe(true);
    expect(payload.apiReady).toBe(true);
    expect(payload.authenticatedContext.actorId).toBe('bootstrap:e2e');
    expect(payload.authenticatedContext.installationId).toBe('e2e-installation');
    expect(payload.authenticatedContext.sourceApp).toBe('npp-core-api');
    expect(payload.r2State.enabled).toBe(false);
    expect(payload.r2State.contractRouteEnabled).toBe(false);
    expectNoSensitiveData(JSON.stringify(payload));
  });

  test('page HTML contains no server credential or provider detail', async ({ page }) => {
    await page.goto('/foundation');
    expectNoSensitiveData(await page.content());
  });

  test('gateway failure renders a safe, recoverable error state', async ({ page }) => {
    await page.route('**/api/foundation/status', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'FOUNDATION_GATEWAY_UNAVAILABLE',
            message: 'Foundation status is temporarily unavailable',
            retryable: true,
          },
        }),
      });
    });

    await page.goto('/foundation');
    const banner = page.getByTestId('foundation-error');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Foundation status is temporarily unavailable');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    expectNoSensitiveData(await page.content());
  });

  test('has no uncaught browser or console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/foundation');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});
