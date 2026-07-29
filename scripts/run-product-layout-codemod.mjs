import { readFile, writeFile } from 'node:fs/promises';

const scriptUrl = new URL('./apply-product-catalog-layout.mjs', import.meta.url);
let source = await readFile(scriptUrl, 'utf8');

function replaceOnce(from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing runner fragment: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Runner fragment is not unique: ${label}`);
  source = source.slice(0, first) + to + source.slice(first + from.length);
}

replaceOnce(
  '      const next = await requestJson<ProductVariant[]>(`/api/products/${nextProductId}/variants`);',
  '      const next = await requestJson<ProductVariant[]>(\\`/api/products/\\${nextProductId}/variants\\`);',
  'variant request template',
);
replaceOnce(
  "                  <div><dt>Sản phẩm</dt><dd>{selectedProduct ? `${selectedProduct.code} — ${selectedProduct.name}` : '—'}</dd></div>",
  "                  <div><dt>Sản phẩm</dt><dd>{selectedProduct ? \\`${selectedProduct.code} — ${selectedProduct.name}\\` : '—'}</dd></div>",
  'selected product summary template',
);
replaceOnce(
  "await rm(pathFromRoot('scripts/apply-product-catalog-layout.mjs'));\nawait rm(pathFromRoot('.github/workflows/apply-product-catalog-layout.yml'));",
  "await rm(pathFromRoot('scripts/run-product-layout-codemod.mjs'));\nawait rm(pathFromRoot('scripts/apply-product-catalog-layout.mjs'));\nawait rm(pathFromRoot('.github/workflows/apply-product-catalog-layout.yml'));",
  'temporary runner cleanup',
);

await writeFile(scriptUrl, source, 'utf8');
await import(`${scriptUrl.href}?run=${Date.now()}`);
