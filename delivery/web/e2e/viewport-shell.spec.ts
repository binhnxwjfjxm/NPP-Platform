import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.getByLabel('Tên đăng nhập').fill('driver-a');
  await page.getByLabel('Mật khẩu').fill('delivery-test-password');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/$/);
}

const viewports = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

for (const viewport of viewports) {
  test(`khung Delivery phủ kín viewport ${viewport.width}x${viewport.height} sau reload`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    await page.reload();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Chuyến của tôi' })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const frame = document.querySelector<HTMLElement>('[data-delivery-app-frame]');
      const dock = document.querySelector<HTMLElement>('.deliveryAppDock');
      const items = Array.from(document.querySelectorAll<HTMLElement>('.deliveryDockItem'));
      if (!frame || !dock || items.length === 0) throw new Error('Delivery app geometry is missing');

      const frameRect = frame.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      const dockStyle = getComputedStyle(dock);
      const paddingBottom = Number.parseFloat(dockStyle.paddingBottom) || 0;
      const itemRects = items.map((item) => item.getBoundingClientRect());
      const bottomNode = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);

      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        frameTop: frameRect.top,
        frameLeft: frameRect.left,
        frameRight: frameRect.right,
        frameBottom: frameRect.bottom,
        dockBottom: dockRect.bottom,
        dockContentBottom: dockRect.bottom - paddingBottom,
        maxItemBottom: Math.max(...itemRects.map((rect) => rect.bottom)),
        minItemHeight: Math.min(...itemRects.map((rect) => rect.height)),
        bottomPointInsideFrame: Boolean(bottomNode && frame.contains(bottomNode)),
        bottomPointInsideDock: Boolean(bottomNode && dock.contains(bottomNode)),
      };
    });

    expect(Math.abs(geometry.frameTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.frameLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.frameRight - geometry.viewportWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.frameBottom - geometry.viewportHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.dockBottom - geometry.viewportHeight)).toBeLessThanOrEqual(1);
    expect(geometry.maxItemBottom).toBeLessThanOrEqual(geometry.dockContentBottom + 1);
    expect(geometry.minItemHeight).toBeGreaterThanOrEqual(48);
    expect(geometry.bottomPointInsideFrame).toBe(true);
    expect(geometry.bottomPointInsideDock).toBe(true);
  });
}
