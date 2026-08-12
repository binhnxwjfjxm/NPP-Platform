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

  test('keeps the access submenu stable while opening and switching access tabs', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard');

    const navScroll = page.getByTestId('sidebar-nav-scroll');
    const accessToggle = page.getByTestId('access-menu-toggle');
    const accessSubnav = page.getByTestId('access-menu-toggle-subnav');

    await navScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(accessToggle).toBeVisible();
    const beforeOpen = await accessToggle.boundingBox();

    await accessToggle.click();
    await expect(accessToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('nav-roles')).toBeVisible();
    await expect(accessSubnav).toHaveCSS('transition-duration', '0s');
    const afterOpen = await accessToggle.boundingBox();
    expect(Math.abs((afterOpen?.y ?? 0) - (beforeOpen?.y ?? 0))).toBeLessThan(4);

    const scrollBeforeRoute = await navScroll.evaluate((element) => element.scrollTop);
    const toggleBeforeRoute = await accessToggle.boundingBox();
    expect(scrollBeforeRoute).toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByTestId('nav-roles').click();
    await expect(page).toHaveURL(/\/access\/roles$/);
    await expect(accessToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('app-content')).toHaveCSS('animation-name', 'none');
    await expect.poll(async () => Math.abs((await navScroll.evaluate((element) => element.scrollTop)) - scrollBeforeRoute)).toBeLessThan(4);
    const toggleOnRoles = await accessToggle.boundingBox();
    expect(Math.abs((toggleOnRoles?.y ?? 0) - (toggleBeforeRoute?.y ?? 0))).toBeLessThan(4);

    await page.getByTestId('nav-users').click();
    await expect(page).toHaveURL(/\/access\/users$/);
    await expect(accessToggle).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => Math.abs((await navScroll.evaluate((element) => element.scrollTop)) - scrollBeforeRoute)).toBeLessThan(4);
    const toggleOnUsers = await accessToggle.boundingBox();
    expect(Math.abs((toggleOnUsers?.y ?? 0) - (toggleBeforeRoute?.y ?? 0))).toBeLessThan(4);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('nav-employees').click();
    await expect(page).toHaveURL(/\/access\/employees$/);
    await expect(page.getByTestId('app-content')).toHaveCSS('animation-name', 'none');
    await expect(accessSubnav).toHaveCSS('transition-duration', '0s');
  });
});