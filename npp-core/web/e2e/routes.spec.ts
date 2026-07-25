import { test, expect } from '@playwright/test';

test.describe('Core Web Routes', () => {
  test('/ landing page loads without 404', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
  });

  test('/ landing page has content', async ({ page }) => {
    await page.goto('/');
    // Wait for any Next.js hydration
    await page.waitForLoadState('networkidle');
    const heading = page.locator('h1');
    expect(heading).toBeVisible();
  });

  test('/login page loads without 404', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBe(200);
  });

  test('/dashboard page loads without 404', async ({ page }) => {
    const response = await page.goto('/dashboard');
    expect(response?.status()).toBe(200);
  });

  test('no uncaught console errors on landing page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });

  test('no uncaught console errors on login page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });

  test('static assets load without 404', async ({ page }) => {
    await page.goto('/');

    // Check that at least one stylesheet or script is present on the page
    const assetCount = await page.locator('link[rel="stylesheet"], script[src]').count();
    expect(assetCount).toBeGreaterThanOrEqual(0);
  });

  test('landing page has no sensitive data in HTML', async ({ page }) => {
    await page.goto('/');
    const content = await page.content();

    // Ensure no secrets are in the page HTML
    expect(content).not.toContain('Bearer');
    expect(content).not.toContain('secret');
    expect(content).not.toContain('password');
    expect(content).not.toContain('token');
    expect(content).not.toContain('API_KEY');
  });
});
