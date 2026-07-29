from pathlib import Path

path = Path('npp-core/web/e2e/goods-receipts.spec.ts')
text = path.read_text(encoding='utf-8')
second_save = """    await page.getByTestId('goods-receipt-save-button').click();
    await expect(page.getByRole('status')).toBeVisible();

    await page.getByTestId('goods-receipt-search').fill(secondReference);"""
second_save_fixed = """    await page.getByTestId('goods-receipt-save-button').click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Đã tạo phiếu nhận hàng nháp');

    await page.getByTestId('goods-receipt-search').fill(secondReference);"""
if text.count(second_save) != 1:
    raise SystemExit(f'second save target count: {text.count(second_save)}')
text = text.replace(second_save, second_save_fixed, 1)
shortage_post = """    await receiptRow.getByRole('button', { name: 'Ghi sổ', exact: true }).click();
    await page.getByTestId('goods-receipt-post-confirm').click();

    await page.goto('/purchasing/purchase-orders');"""
shortage_post_fixed = """    await receiptRow.getByRole('button', { name: 'Ghi sổ', exact: true }).click();
    await page.getByTestId('goods-receipt-post-confirm').click();
    await expect(receiptRow.getByRole('button')).toHaveCount(2);
    await expect(page.getByRole('status')).toContainText('đã được ghi sổ');

    await page.goto('/purchasing/purchase-orders');"""
if text.count(shortage_post) != 1:
    raise SystemExit(f'shortage post target count: {text.count(shortage_post)}')
text = text.replace(shortage_post, shortage_post_fixed, 1)
path.write_text(text, encoding='utf-8', newline='\n')
