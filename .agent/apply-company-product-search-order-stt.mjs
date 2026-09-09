import { readFileSync, writeFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Không tìm thấy đoạn cần sửa: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Đoạn cần sửa xuất hiện nhiều hơn một lần: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRegexOnce(source, pattern, after, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) throw new Error(`Cần đúng 1 match cho ${label}, thực tế ${matches.length}`);
  return source.replace(pattern, after);
}

function edit(path, transform) {
  const source = readFileSync(path, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`Không có thay đổi ở ${path}`);
  writeFileSync(path, next);
}

function writeNew(path, content) {
  if (existsSync(path)) throw new Error(`File đã tồn tại ngoài dự kiến: ${path}`);
  writeFileSync(path, content);
}

// 1) Shared product search contract.
writeFileSync('npp-core/web/lib/product-search-contract.js', `export const MIN_PRODUCT_SEARCH_LENGTH = 1;

export function normalizedProductSearchTerm(value) {
  const term = String(value ?? '').trim();
  return term.length >= MIN_PRODUCT_SEARCH_LENGTH ? term : '';
}

export function normalizeProductSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

export function productSearchTokens(value) {
  const normalized = normalizeProductSearchText(value);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

export function productSearchMatches(values, query) {
  const tokens = productSearchTokens(query);
  if (tokens.length === 0) return true;
  const haystack = (Array.isArray(values) ? values : [values])
    .map(normalizeProductSearchText)
    .filter(Boolean)
    .join(' ');
  return tokens.every((token) => haystack.includes(token));
}
`);

writeFileSync('npp-core/web/lib/product-search-contract.d.ts', `export const MIN_PRODUCT_SEARCH_LENGTH: number;
export function normalizedProductSearchTerm(value: unknown): string;
export function normalizeProductSearchText(value: unknown): string;
export function productSearchTokens(value: unknown): string[];
export function productSearchMatches(values: readonly unknown[] | unknown, query: unknown): boolean;
`);

// 2) Stable product creation sequence and newest-first display.
writeNew('npp-core/web/lib/product-list-order.js', `function createdAtMillis(product) {
  const parsed = Date.parse(String(product?.created_at ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareProductCreation(left, right) {
  const timeDifference = createdAtMillis(left) - createdAtMillis(right);
  if (timeDifference !== 0) return timeDifference;
  const codeDifference = String(left?.code ?? '').localeCompare(String(right?.code ?? ''), 'vi');
  if (codeDifference !== 0) return codeDifference;
  return String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
}

export function productCreationSequence(products) {
  const ordered = [...(Array.isArray(products) ? products : [])].sort(compareProductCreation);
  return new Map(ordered.map((product, index) => [product.id, index + 1]));
}

export function sortProductsNewestFirst(products) {
  return [...(Array.isArray(products) ? products : [])]
    .sort((left, right) => compareProductCreation(right, left));
}
`);

writeNew('npp-core/web/lib/product-list-order.d.ts', `type ProductCreationItem = {
  id: string;
  code?: string | null;
  created_at?: string | null;
};

export function productCreationSequence<T extends ProductCreationItem>(products: readonly T[]): Map<string, number>;
export function sortProductsNewestFirst<T extends ProductCreationItem>(products: readonly T[]): T[];
`);

// 3) Browser-safe full product reload.
writeNew('npp-core/web/lib/product-catalog-client-pagination.js', `export const PRODUCT_CATALOG_PAGE_SIZE = 1000;
export const PRODUCT_CATALOG_MAX_OFFSET = 10000;

export async function collectAllProductPages(loadPage) {
  const products = [];
  for (let offset = 0; offset <= PRODUCT_CATALOG_MAX_OFFSET; offset += PRODUCT_CATALOG_PAGE_SIZE) {
    const page = await loadPage({ limit: PRODUCT_CATALOG_PAGE_SIZE, offset });
    if (!Array.isArray(page)) throw new Error('Phản hồi danh mục sản phẩm không hợp lệ');
    products.push(...page);
    if (page.length < PRODUCT_CATALOG_PAGE_SIZE) return products;
  }
  throw new Error('Danh mục sản phẩm vượt phạm vi tải an toàn');
}
`);

writeNew('npp-core/web/lib/product-catalog-client-pagination.d.ts', `export const PRODUCT_CATALOG_PAGE_SIZE: number;
export const PRODUCT_CATALOG_MAX_OFFSET: number;
export function collectAllProductPages<T>(
  loadPage: (page: { limit: number; offset: number }) => Promise<T[]>,
): Promise<T[]>;
`);

// 4) Generic sequence component accepts a business-stable value without changing default behavior.
edit('npp-core/web/app/components/business-table-sequence.tsx', (source) => {
  let next = replaceOnce(source,
`type SequenceCellProps = {
  rowIndex: number;
  offset?: number;
  className?: string;
};

type SequenceNumberProps = {
  rowIndex: number;
  offset?: number;
  className?: string;
};`,
`type SequenceCellProps = {
  rowIndex: number;
  offset?: number;
  value?: number;
  className?: string;
};

type SequenceNumberProps = {
  rowIndex: number;
  offset?: number;
  value?: number;
  className?: string;
};

function resolvedSequenceNumber(rowIndex: number, offset: number, value?: number) {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : businessTableRowNumber(rowIndex, offset);
}`,
'sequence props');
  next = replaceOnce(next,
`export function BusinessTableSequenceCell({ rowIndex, offset = 0, className }: SequenceCellProps) {
  return (
    <td className={className} data-business-table-sequence>
      {businessTableRowNumber(rowIndex, offset)}
    </td>
  );
}

/** Dùng cho danh sách dạng thẻ hoặc lưới, nơi không có cột bảng HTML. */
export function BusinessSequenceNumber({ rowIndex, offset = 0, className }: SequenceNumberProps) {
  return (
    <span className={className} data-business-sequence aria-label={`Số thứ tự ${businessTableRowNumber(rowIndex, offset)}`}>
      {businessTableRowNumber(rowIndex, offset)}
    </span>
  );
}`,
`export function BusinessTableSequenceCell({ rowIndex, offset = 0, value, className }: SequenceCellProps) {
  return (
    <td className={className} data-business-table-sequence>
      {resolvedSequenceNumber(rowIndex, offset, value)}
    </td>
  );
}

/** Dùng cho danh sách dạng thẻ hoặc lưới, nơi không có cột bảng HTML. */
export function BusinessSequenceNumber({ rowIndex, offset = 0, value, className }: SequenceNumberProps) {
  const number = resolvedSequenceNumber(rowIndex, offset, value);
  return (
    <span className={className} data-business-sequence aria-label={`Số thứ tự ${number}`}>
      {number}
    </span>
  );
}`,
'sequence render');
  return next;
});

// 5) Product catalog: stable STT, flexible matching, full refresh.
edit('npp-core/web/app/products/product-workspace.tsx', (source) => {
  let next = replaceOnce(source,
`import type { ProductImageIndex } from '../../lib/product-images';
import styles from './products.module.css';`,
`import type { ProductImageIndex } from '../../lib/product-images';
import { productSearchMatches } from '../../lib/product-search-contract';
import { productCreationSequence, sortProductsNewestFirst } from '../../lib/product-list-order';
import { collectAllProductPages } from '../../lib/product-catalog-client-pagination';
import styles from './products.module.css';`,
'product imports');

  next = replaceRegexOnce(next,
`function normalizeSearch\(value: string \| null \| undefined\) \{[\s\S]*?\n\}\n\nfunction managementScreenLabel`,
`function managementScreenLabel`,
'remove product local search normalizer');

  next = replaceOnce(next,
`  return payload.data as T;
}

function productToForm`,
`  return payload.data as T;
}

async function requestAllProducts(): Promise<Product[]> {
  return collectAllProductPages(({ limit, offset }) =>
    requestJson<Product[]>(`/api/products?limit=${limit}&offset=${offset}`));
}

function productToForm`,
'product full reload helper');

  next = replaceRegexOnce(next,
`  const normalizedSearch = normalizeSearch\(search\);\n  const visibleProducts = useMemo\(\(\) => products\.filter\(\(product\) => \{[\s\S]*?\n  \}\), \[products, normalizedSearch, statusFilter, catalogFilter, orderableFilter\]\);`,
`  const productSequence = useMemo(() => productCreationSequence(products), [products]);
  const visibleProducts = useMemo(() => sortProductsNewestFirst(products.filter((product) => {
    if (statusFilter === 'active' && !product.is_active) return false;
    if (statusFilter === 'inactive' && product.is_active) return false;
    if (catalogFilter === 'visible' && !product.is_catalog_visible) return false;
    if (catalogFilter === 'hidden' && product.is_catalog_visible) return false;
    if (orderableFilter === 'yes' && !product.is_orderable) return false;
    if (orderableFilter === 'no' && product.is_orderable) return false;
    return productSearchMatches(
      [product.code, product.name, product.catalog_name, product.category_name, product.brand_name],
      search,
    );
  })), [products, search, statusFilter, catalogFilter, orderableFilter]);`,
'product visible filter');

  next = replaceOnce(next,
`        requestJson<Product[]>('/api/products?limit=1000'),`,
`        requestAllProducts(),`,
'product reload all pages');

  next = replaceOnce(next,
`                <BusinessTableSequenceCell rowIndex={rowIndex} />`,
`                <BusinessTableSequenceCell rowIndex={rowIndex} value={productSequence.get(product.id)} />`,
'product stable sequence cell');
  return next;
});

// 6) Quick Setup shares the same flexible matching contract.
edit('npp-core/web/app/products/product-quick-setup-workspace.tsx', (source) => {
  let next = replaceOnce(source,
`import type { PriceList, PriceListItem } from '../../lib/pricing-types';
import ProductImageControl`,
`import type { PriceList, PriceListItem } from '../../lib/pricing-types';
import { productSearchMatches } from '../../lib/product-search-contract';
import ProductImageControl`,
'quick setup shared search import');

  next = replaceRegexOnce(next,
`function normalizeSearch\(value: string \| null \| undefined\) \{[\s\S]*?\n\}\n\nfunction isZeroQuantity`,
`function isZeroQuantity`,
'remove quick setup local normalizer');

  next = replaceOnce(next,
`  const visibleProducts = useMemo(() => {
    const term = normalizeSearch(search);
    if (!term) return products;
    return products.filter((item) =>
      [item.code, item.name, item.catalog_name, item.category_name, item.brand_name]
        .some((value) => normalizeSearch(value).includes(term)),
    );
  }, [products, search]);`,
`  const visibleProducts = useMemo(() =>
    products.filter((item) => productSearchMatches(
      [item.code, item.name, item.catalog_name, item.category_name, item.brand_name],
      search,
    )), [products, search]);`,
'quick setup visible filter');
  return next;
});

// 7) Sales order: newest line stays on top for work, but official STT/persistence/print follow entry order.
edit('npp-core/web/app/sales/sales-orders/SalesOrderCommercialForm.tsx', (source) => {
  let next = replaceOnce(source,
`  return (version?.lines ?? []).map((line) => ({`,
`  return [...(version?.lines ?? [])].reverse().map((line) => ({`,
'reopen newest-first');

  next = replaceRegexOnce(next,
`  const estimate = useMemo\(\(\) => \{\n    const gross = lines\.map\(grossMinor\);[\s\S]*?\n  \}, \[documentDiscountMode, documentDiscountValue, lines\]\);`,
`  const estimate = useMemo(() => {
    const canonicalLines = [...lines].reverse();
    const gross = canonicalLines.map(grossMinor);
    const grossTotal = gross.reduce((sum, value) => sum + value, 0n);
    const lineDiscounts = canonicalLines.map(lineDiscountMinor);
    const lineDiscountValid = lineDiscounts.every((value) => value !== null);
    const lineDiscountValues = lineDiscounts.map((value) => value ?? 0n);
    const lineDiscountTotal = lineDiscountValues.reduce((sum, value) => sum + value, 0n);
    const target = documentDiscountTarget(documentDiscountMode, documentDiscountValue, grossTotal);
    const documentAllocations = target === null ? null : largestRemainder(gross, target);
    const documentDiscountTotal = documentAllocations?.reduce((sum, value) => sum + value, 0n) ?? 0n;
    const mixedScope = lineDiscountTotal > 0n && documentDiscountTotal > 0n;
    const effectiveDiscounts = documentDiscountTotal > 0n
      ? (documentAllocations ?? gross.map(() => 0n))
      : lineDiscountValues;
    const canonicalDetails = canonicalLines.map((line, index) =>
      estimateLine(line, effectiveDiscounts[index] ?? 0n));
    return {
      valid: target !== null && documentAllocations !== null && lineDiscountValid && !mixedScope,
      gross: grossTotal,
      discount: effectiveDiscounts.reduce((sum, value) => sum + value, 0n),
      tax: canonicalDetails.reduce((sum, value) => sum + value.tax, 0n),
      total: canonicalDetails.reduce((sum, value) => sum + value.total, 0n),
      lineDiscountTotal,
      documentDiscountTotal,
      mixedScope,
      details: [...canonicalDetails].reverse(),
    };
  }, [documentDiscountMode, documentDiscountValue, lines]);`,
'canonical sales estimate');

  next = replaceOnce(next,
`      return [...current.slice(0, sourceIndex + 1), split, ...current.slice(sourceIndex + 1)];`,
`      return [...current.slice(0, sourceIndex), split, ...current.slice(sourceIndex)];`,
'split official order');

  next = replaceOnce(next,
`      lines: lines.map((line) => ({`,
`      lines: [...lines].reverse().map((line) => ({`,
'persist official entry order');

  next = replaceOnce(next,
`                <BusinessSequenceNumber rowIndex={index} className={styles.lineSequence} />`,
`                <BusinessSequenceNumber rowIndex={index} value={lines.length - index} className={styles.lineSequence} />`,
'sales stable entry STT');
  return next;
});

// 8) Canonical backend SKU search: accent-insensitive, token containment, preserved exact/prefix priority.
edit('npp-core/api/src/db/repositories/sales-order.js', (source) => {
  return replaceRegexOnce(source,
`export async function searchSalesOrderSkuOptions\(client, \{[\s\S]*?\n\}\n\nexport async function listOrderableSalesVariantIds`,
`export async function searchSalesOrderSkuOptions(client, {
  installationId, search, categoryId = null, retailSearch = false, limit = 20, offset = 0,
}) {
  const term = String(search ?? '').trim();
  const normalizedExact = term.toUpperCase();
  const normalizedSearch = term
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
  const searchTokens = normalizedSearch ? normalizedSearch.split(' ').filter(Boolean) : [];
  const vietnameseSearchCharacters = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
  const asciiSearchCharacters = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';
  const result = await client.query(
    `SELECT ${SKU_OPTION_COLUMNS}
     FROM shared.product_variants pv
     JOIN shared.products p
       ON p.installation_id = pv.installation_id AND p.id = pv.product_id
     LEFT JOIN shared.units_of_measure u
       ON u.installation_id = pv.installation_id AND u.id = pv.unit_id
     LEFT JOIN LATERAL (
       SELECT pb.barcode
       FROM shared.product_barcodes pb
       WHERE pb.installation_id = pv.installation_id
         AND pb.variant_id = pv.id
         AND pb.is_active = true
       ORDER BY pb.is_primary DESC, pb.created_at ASC, pb.id ASC
       LIMIT 1
     ) primary_barcode ON true
     WHERE pv.installation_id = $1
       AND p.is_active = true
       AND p.is_orderable = true
       AND pv.is_active = true
       AND pv.is_sellable = true
       AND pv.unit_id IS NOT NULL
       AND u.is_active = true
       AND pv.conversion_to_base IS NOT NULL
       AND pv.conversion_to_base > 0
       AND ($5::uuid IS NULL OR p.category_id = $5::uuid)
       AND (
         $3 = ''
         OR NOT EXISTS (
           SELECT 1
           FROM unnest($4::text[]) AS search_token(value)
           WHERE NOT (
             strpos(translate(lower(COALESCE(pv.sku, '')), $7, $8), search_token.value) > 0
             OR strpos(translate(lower(COALESCE(pv.name, '')), $7, $8), search_token.value) > 0
             OR strpos(translate(lower(COALESCE(p.code, '')), $7, $8), search_token.value) > 0
             OR strpos(translate(lower(COALESCE(p.name, '')), $7, $8), search_token.value) > 0
             OR EXISTS (
               SELECT 1
               FROM shared.product_barcodes matching_barcode
               WHERE matching_barcode.installation_id = pv.installation_id
                 AND matching_barcode.variant_id = pv.id
                 AND matching_barcode.is_active = true
                 AND strpos(
                   translate(lower(COALESCE(matching_barcode.normalized_barcode, '')), $7, $8),
                   search_token.value
                 ) > 0
             )
           )
         )
       )
     ORDER BY
       CASE
         WHEN upper(pv.sku) = $2 THEN 0
         WHEN upper(p.code) = $2 THEN 1
         WHEN EXISTS (
           SELECT 1
           FROM shared.product_barcodes exact_barcode
           WHERE exact_barcode.installation_id = pv.installation_id
             AND exact_barcode.variant_id = pv.id
             AND exact_barcode.is_active = true
             AND exact_barcode.normalized_barcode = $2
         ) THEN 2
         WHEN $6::boolean AND upper(pv.sku) LIKE $2 || '%' THEN 3
         WHEN $6::boolean AND upper(p.code) LIKE $2 || '%' THEN 4
         WHEN $3 <> '' AND translate(lower(COALESCE(p.name, '')), $7, $8) = $3 THEN 5
         WHEN $3 <> '' AND translate(lower(COALESCE(pv.name, '')), $7, $8) = $3 THEN 6
         WHEN $3 <> '' AND strpos(translate(lower(COALESCE(p.name, '')), $7, $8), $3) = 1 THEN 7
         WHEN $3 <> '' AND strpos(translate(lower(COALESCE(pv.name, '')), $7, $8), $3) = 1 THEN 8
         ELSE 9
       END,
       p.code ASC,
       pv.sku ASC,
       pv.id ASC
     LIMIT $9 OFFSET $10`,
    [
      installationId,
      normalizedExact,
      normalizedSearch,
      searchTokens,
      categoryId,
      retailSearch,
      vietnameseSearchCharacters,
      asciiSearchCharacters,
      limit,
      offset,
    ],
  );
  return result.rows;
}

export async function listOrderableSalesVariantIds`,
'sales SKU search function');
});

// 9) Update and extend contracts.
edit('npp-core/web/test/product-search-contract.test.js', (source) => {
  let next = replaceOnce(source,
`  MIN_PRODUCT_SEARCH_LENGTH,
  normalizedProductSearchTerm,`,
`  MIN_PRODUCT_SEARCH_LENGTH,
  normalizedProductSearchTerm,
  normalizeProductSearchText,
  productSearchMatches,
  productSearchTokens,`,
'product search test imports');
  next = replaceOnce(next,
`test('all Company SKU entry surfaces use the shared first-character contract', () => {`,
`test('product search accepts Vietnamese text by tokens instead of requiring one contiguous phrase', () => {
  assert.equal(normalizeProductSearchText(' Thạch ĐỎ '), 'thach do');
  assert.deepEqual(productSearchTokens('thạch dừa vải'), ['thach', 'dua', 'vai']);
  assert.equal(productSearchMatches(['Thạch DX Dừa Vải'], 'thạch dừa vải'), true);
  assert.equal(productSearchMatches(['Thạch DX Dừa Vải'], 'dua vai'), true);
  assert.equal(productSearchMatches(['Mama Lựu'], 'ma lựu'), true);
  assert.equal(productSearchMatches(['Mama Lựu'], 'ma xoài'), false);
});

test('all Company SKU entry surfaces use the shared first-character contract', () => {`,
'staff search examples');
  return next;
});

edit('npp-core/api/test/retail-catalog-security-contract.test.js', (source) => {
  let next = replaceOnce(source, `/p\.category_id = \$4::uuid/`, `/p\.category_id = \$5::uuid/`, 'retail category param');
  next = replaceOnce(next, `/\$5::boolean AND upper\(pv\.sku\) LIKE \$2 \|\| '%'/`, `/\$6::boolean AND upper\(pv\.sku\) LIKE \$2 \|\| '%'/`, 'retail prefix filter param');
  next = replaceOnce(next, `/WHEN \$5::boolean AND upper\(pv\.sku\) LIKE \$2 \|\| '%' THEN 3/`, `/WHEN \$6::boolean AND upper\(pv\.sku\) LIKE \$2 \|\| '%' THEN 3/`, 'retail prefix rank param');
  next = replaceOnce(next, `assert.equal(calls[0].params[4], false);`, `assert.equal(calls[0].params[5], false);`, 'retail false param');
  next = replaceOnce(next, `assert.equal(calls[1].params[4], true);`, `assert.equal(calls[1].params[5], true);`, 'retail true param');
  next = replaceOnce(next, `assert.match(calls[0].statement, /ELSE 3/);`, `assert.match(calls[0].statement, /ELSE 9/);`, 'retail fallback rank');
  return next;
});

edit('npp-core/api/test/sales-order-entry-pagination.test.js', (source) =>
  replaceOnce(source,
    `const limitIndex = statement.indexOf('LIMIT $6 OFFSET $7');`,
    `const limitIndex = statement.indexOf('LIMIT $9 OFFSET $10');`,
    'sales pagination placeholders'));

// 10) New focused regression tests.
writeNew('npp-core/web/test/company-product-order-stt.test.mjs', `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { productCreationSequence, sortProductsNewestFirst } from '../lib/product-list-order.js';
import { collectAllProductPages } from '../lib/product-catalog-client-pagination.js';

function product(id, code, createdAt) {
  return { id, code, created_at: createdAt };
}

test('STT sản phẩm giữ theo thứ tự tạo và không bị đánh lại khi lọc', () => {
  const rows = [
    product('p2', 'SP002', '2026-01-02T00:00:00.000Z'),
    product('p1', 'SP001', '2026-01-01T00:00:00.000Z'),
    product('p3', 'SP003', '2026-01-03T00:00:00.000Z'),
  ];
  const sequence = productCreationSequence(rows);
  assert.equal(sequence.get('p1'), 1);
  assert.equal(sequence.get('p2'), 2);
  assert.equal(sequence.get('p3'), 3);
  assert.deepEqual(sortProductsNewestFirst(rows).map((item) => item.id), ['p3', 'p2', 'p1']);

  const filtered = rows.filter((item) => item.id === 'p2');
  assert.equal(sequence.get(filtered[0].id), 2);
});

test('Làm mới danh mục tải tiếp sau 1.000 sản phẩm', async () => {
  const calls = [];
  const rows = await collectAllProductPages(async ({ limit, offset }) => {
    calls.push({ limit, offset });
    if (offset === 0) return Array.from({ length: 1000 }, (_, index) => ({ id: `p-${index}` }));
    if (offset === 1000) return [{ id: 'p-1000' }, { id: 'p-1001' }];
    return [];
  });
  assert.equal(rows.length, 1002);
  assert.deepEqual(calls, [{ limit: 1000, offset: 0 }, { limit: 1000, offset: 1000 }]);
});

test('Danh mục và Thiết lập nhanh dùng chung hợp đồng tìm hàng linh hoạt', () => {
  const productWorkspace = readFileSync(new URL('../app/products/product-workspace.tsx', import.meta.url), 'utf8');
  const quickSetup = readFileSync(new URL('../app/products/product-quick-setup-workspace.tsx', import.meta.url), 'utf8');
  assert.match(productWorkspace, /productSearchMatches/);
  assert.match(productWorkspace, /productCreationSequence/);
  assert.match(productWorkspace, /sortProductsNewestFirst/);
  assert.match(productWorkspace, /collectAllProductPages/);
  assert.match(productWorkspace, /value=\{productSequence\.get\(product\.id\)\}/);
  assert.match(quickSetup, /productSearchMatches/);
  assert.doesNotMatch(productWorkspace, /function normalizeSearch/);
  assert.doesNotMatch(quickSetup, /function normalizeSearch/);
});

test('Đơn bán giữ hàng mới trên cùng nhưng lưu và in theo thứ tự nhập', () => {
  const form = readFileSync(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url), 'utf8');
  const print = readFileSync(new URL('../app/sales/sales-orders/SalesOrderPrintSheet.tsx', import.meta.url), 'utf8');
  assert.match(form, /setLines\(\(current\) => \[pending, \.\.\.current\]\)/);
  assert.match(form, /value=\{lines\.length - index\}/);
  assert.match(form, /lines: \[\.\.\.lines\]\.reverse\(\)\.map/);
  assert.match(form, /return \[\.\.\.\(version\?\.lines \?\? \[\]\)\]\.reverse\(\)\.map/);
  assert.match(form, /const canonicalLines = \[\.\.\.lines\]\.reverse\(\)/);
  assert.match(form, /details: \[\.\.\.canonicalDetails\]\.reverse\(\)/);
  assert.match(form, /current\.slice\(0, sourceIndex\), split, \.\.\.current\.slice\(sourceIndex\)/);
  assert.match(print, /no: line\.lineNumber/);
});
`);

writeNew('npp-core/api/test/company-product-search.test.js', `import assert from 'node:assert/strict';
import test from 'node:test';
import * as repository from '../src/db/repositories/sales-order.js';

test('Tìm hàng bán hỗ trợ tiếng Việt theo từng từ và giữ ưu tiên mã chính xác', async () => {
  const calls = [];
  const client = {
    async query(statement, params) {
      calls.push({ statement, params });
      return { rows: [] };
    },
  };

  await repository.searchSalesOrderSkuOptions(client, {
    installationId: '66666666-6666-4666-8666-666666666666',
    search: 'thạch dừa vải',
    limit: 30,
    offset: 0,
  });

  assert.equal(calls.length, 1);
  const first = calls[0];
  assert.equal(first.params[2], 'thach dua vai');
  assert.deepEqual(first.params[3], ['thach', 'dua', 'vai']);
  assert.equal(first.params[5], false);
  assert.equal(first.params.at(-2), 30);
  assert.equal(first.params.at(-1), 0);
  assert.match(first.statement, /FROM unnest\(\$4::text\[\]\) AS search_token/);
  assert.match(first.statement, /p\.category_id = \$5::uuid/);
  assert.match(first.statement, /translate\(lower\(COALESCE\(p\.name, ''\)\), \$7, \$8\)/);
  assert.match(first.statement, /WHEN upper\(pv\.sku\) = \$2 THEN 0/);
  assert.match(first.statement, /WHEN \$6::boolean AND upper\(pv\.sku\) LIKE \$2 \|\| '%' THEN 3/);
  assert.match(first.statement, /LIMIT \$9 OFFSET \$10/);

  await repository.searchSalesOrderSkuOptions(client, {
    installationId: '66666666-6666-4666-8666-666666666666',
    search: 'ma lựu',
  });
  assert.equal(calls[1].params[2], 'ma luu');
  assert.deepEqual(calls[1].params[3], ['ma', 'luu']);
});
`);

// 11) Self-delete the one-shot tooling so the branch contains only the product changes.
for (const path of [
  '.agent/apply-company-product-search-order-stt.mjs',
  '.github/workflows/one-shot-company-product-search-order-stt.yml',
]) {
  if (existsSync(path)) unlinkSync(path);
}
try { rmdirSync('.agent'); } catch {}
