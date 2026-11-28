import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../app/components/print-document.tsx', import.meta.url), 'utf8');
const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
  .replace(/^@import .*;$/gm, '');
const printCss = readFileSync(new URL('../app/components/print-document.module.css', import.meta.url), 'utf8');
const sheetCss = readFileSync(new URL('../app/components/business-document-print.module.css', import.meta.url), 'utf8');
const script = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

type Sheet = { id: string; size: 'A4' | 'A5'; rows?: number };

function sheet({ id, size, rows = 2 }: Sheet) {
  return '<section class="printSurface" data-print-surface data-print-id="' + id
    + '" data-print-size="' + size + '" data-print-suppress-browser-headers="true"'
    + ' data-print-narrow-margins="true" data-print-footer="Customer - date">'
    + '<article class="sheet"><header class="header"><h1>ORDER ' + id + '</h1></header>'
    + '<table class="table"><thead><tr><th>Item</th></tr></thead><tbody>'
    + Array.from({ length: rows }, (_, i) => '<tr><td>Item ' + (i + 1) + '</td></tr>').join('')
    + '</tbody></table><div class="summary">TOTAL</div></article></section>';
}

async function prepare(page: Page, sheets: Sheet[], ids: string[]) {
  await page.goto('about:blank');
  // A zero-height in-flow node before a named page reproduces the footer-only
  // first sheet in Chromium. The inline important rule intentionally models
  // a browser/runtime-injected node which can override the normal hide rule.
  await page.setContent('<style>' + globals + printCss + sheetCss
    + '</style><div style="display:block!important;height:0"></div><main>'
    + sheets.map(sheet).join('') + '</main>');
  const prepared = await page.evaluate(({ script, ids }) => {
    const exports: { printSurfacesForOutput?: (ids: string[]) => boolean } = {};
    const require = (name: string) => name.endsWith('.module.css')
      ? { printSurface: 'printSurface', printFooterFallback: 'printFooterFallback' } : {};
    new Function('exports', 'require', script)(exports, require);
    const run = exports.printSurfacesForOutput!;
    const nativePrint = window.print;
    window.print = () => {};
    try { return run(ids); } finally { window.print = nativePrint; }
  }, { script, ids });
  expect(prepared).toBe(true);
  await expect(page.locator('[data-print-root] > [data-print-surface]')).toHaveCount(ids.length);
  expect(await page.locator('[data-print-root] > [data-print-surface]').evaluateAll(
    elements => elements.map(element => (element as HTMLElement).dataset.printId)
  )).toEqual(ids);
}

async function pdfPages(page: Page) {
  const pdf = await page.pdf({ preferCSSPageSize: true, displayHeaderFooter: false });
  return (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
}

for (const size of ['A4', 'A5'] as const) {
  test('short ' + size + ' order prints exactly one page including footer', async ({ page }) => {
    await prepare(page, [{ id: 'one', size }], ['one']);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[data-print-footer-fallback]')).toHaveText('Customer - date');
    expect(await pdfPages(page)).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('[data-print-root]')).toHaveCount(0);
    await expect(page.locator('style[data-print-page-style]')).toHaveCount(0);
  });
}

test('batch prints one page per short order in requested order, including mixed paper sizes', async ({ page }) => {
  await prepare(page, [{ id: 'one', size: 'A4' }, { id: 'two', size: 'A5' }, { id: 'three', size: 'A4' }], ['three', 'one', 'two']);
  expect(await pdfPages(page)).toBe(3);
});

test('long orders paginate and repeated print does not retain a previous print root', async ({ page }) => {
  await prepare(page, [{ id: 'long', size: 'A4', rows: 75 }], ['long']);
  const pages = await pdfPages(page);
  expect(pages).toBeGreaterThan(1);
  // Compare with the identical sheet without the extra leading flow node.
  await prepare(page, [{ id: 'long', size: 'A4', rows: 75 }], ['long']);
  await page.locator('body > div').first().evaluate(element => element.remove());
  expect(await pdfPages(page)).toBe(pages);
});
