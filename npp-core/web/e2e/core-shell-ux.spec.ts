import { test, expect } from '@playwright/test';

test.describe('Core shell UX', () => {
  test('shows the authenticated employee and keeps inventory navigation in the sidebar', async ({ page, request }) => {
    const meResponse = await request.get('/api/auth/me');
    expect(meResponse.status()).toBe(200);
    const mePayload = await meResponse.json() as { data?: { employeeFullName?: string | null; loginName?: string | null } };
    const expectedName = mePayload.data?.employeeFullName || mePayload.data?.loginName;
    expect(expectedName).toBeTruthy();

    await page.goto('/inventory/tracking-policies');
    await expect(page.getByTestId('inventory-tracking-policies-page')).toBeVisible();
    await expect(page.getByTestId('sidebar-current-user-name')).toHaveText(String(expectedName));
    await expect(page.getByTestId('inventory-local-controls')).toBeVisible();
    await expect(page.getByLabel('Điều hướng tồn kho')).toHaveCount(0);
    await expect(page.getByText('Về tồn kho', { exact: true })).toHaveCount(0);
  });

  test('opens the access submenu without a sidebar jump and uses light route motion', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard');

    const navScroll = page.getByTestId('sidebar-nav-scroll');
    await navScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const accessToggle = page.getByTestId('access-menu-toggle');
    await expect(accessToggle).toBeVisible();
    const before = await accessToggle.boundingBox();

    await accessToggle.click();
    await expect(accessToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-roles')).toBeVisible();
    const after = await accessToggle.boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(4);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByTestId('nav-roles').click();
    await expect(page).toHaveURL(/\/access\/roles$/);
    const motion = await page.getByTestId('app-content').evaluate((element) => {
      const style = getComputedStyle(element);
      return { name: style.animationName, duration: style.animationDuration };
    });
    expect(motion.name).toBe('contentEnter');
    expect(Number.parseFloat(motion.duration)).toBeLessThanOrEqual(0.18);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('nav-users').click();
    await expect(page).toHaveURL(/\/access\/users$/);
    await expect.poll(() => page.getByTestId('app-content').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  });
});
