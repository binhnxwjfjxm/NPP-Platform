from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, got {count}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1))


# 1) Forward migration: same SKU may have multiple independent lines.
Path('database/migrations/sales/115_sales_order_split_lines.sql').write_text(
    "-- Issue #791 Lot D: allow one SKU to appear on multiple independent Sales Order lines.\n"
    "-- Line identity remains sales_order_version_lines.id / line_number; variant_id is product identity only.\n\n"
    "ALTER TABLE sales.sales_order_version_lines\n"
    "  DROP CONSTRAINT IF EXISTS sales_order_version_lines_variant_unique;\n\n"
    "CREATE INDEX IF NOT EXISTS sales_order_version_lines_variant_idx\n"
    "  ON sales.sales_order_version_lines (\n"
    "    installation_id, sales_order_version_id, variant_id, line_number\n"
    "  );\n"
)

# 2) Canonical migration registry.
replace_once(
    'npp-core/api/src/migrations/index.js',
    "const SALES_ORDER_PERMISSION_METADATA_SQL = readFileSync(new URL('../../../../database/migrations/shared/114_sales_order_permission_metadata.sql', import.meta.url), 'utf8');\n",
    "const SALES_ORDER_PERMISSION_METADATA_SQL = readFileSync(new URL('../../../../database/migrations/shared/114_sales_order_permission_metadata.sql', import.meta.url), 'utf8');\n"
    "const SALES_ORDER_SPLIT_LINES_SQL = readFileSync(new URL('../../../../database/migrations/sales/115_sales_order_split_lines.sql', import.meta.url), 'utf8');\n",
)
replace_once(
    'npp-core/api/src/migrations/index.js',
    "  Object.freeze({ id: '114_sales_order_permission_metadata', sql: SALES_ORDER_PERMISSION_METADATA_SQL }),\n]);",
    "  Object.freeze({ id: '114_sales_order_permission_metadata', sql: SALES_ORDER_PERMISSION_METADATA_SQL }),\n"
    "  Object.freeze({ id: '115_sales_order_split_lines', sql: SALES_ORDER_SPLIT_LINES_SQL }),\n]);",
)

# 3) Backend: variant_id is no longer unique line identity.
replace_once('npp-core/api/src/services/sales-order-legacy.js', '  const seen = new Set();\n', '')
replace_once(
    'npp-core/api/src/services/sales-order-legacy.js',
    "    if (seen.has(input.variantId)) return failure('DUPLICATE_VARIANT', 'A SKU may only appear once in a Sales Order version', false, { line: index + 1 });\n"
    "    seen.add(input.variantId);\n",
    '',
)

# 4) Frontend: search Add remains unique; explicit split creates the independent duplicate line.
form = 'npp-core/web/app/sales/sales-orders/SalesOrderCommercialForm.tsx'
replace_once(
    form,
    "  function focusLineQuantity(clientLineId: string) {\n"
    "    window.setTimeout(() => {\n"
    "      const input = quantityRefs.current.get(clientLineId);\n"
    "      input?.focus();\n"
    "      input?.select();\n"
    "    }, 0);\n"
    "  }\n\n"
    "  async function addSku(option: SalesOrderSkuSearchOption) {",
    "  function focusLineQuantity(clientLineId: string) {\n"
    "    window.setTimeout(() => {\n"
    "      const input = quantityRefs.current.get(clientLineId);\n"
    "      input?.focus();\n"
    "      input?.select();\n"
    "    }, 0);\n"
    "  }\n\n"
    "  function focusLinePrice(clientLineId: string) {\n"
    "    window.setTimeout(() => {\n"
    "      const input = document.querySelector<HTMLInputElement>(`[data-price-line-id=\"${clientLineId}\"]`);\n"
    "      input?.focus();\n"
    "      input?.select();\n"
    "    }, 0);\n"
    "  }\n\n"
    "  function splitLine(index: number) {\n"
    "    if (!canPriceOverride) {\n"
    "      onError('Cần quyền Sửa giá bán trên đơn để tách dòng.');\n"
    "      return;\n"
    "    }\n"
    "    const source = linesRef.current[index];\n"
    "    if (!source) return;\n"
    "    const clientLineId = crypto.randomUUID();\n"
    "    const split: LineDraft = {\n"
    "      ...source,\n"
    "      clientLineId,\n"
    "      quantity: '1',\n"
    "      manualUnitPriceMinor: '0',\n"
    "      discountMode: 'TOTAL_AMOUNT',\n"
    "      discountValue: '0',\n"
    "      pricingFingerprint: '',\n"
    "      priceSteps: [],\n"
    "      resolvingPrice: false,\n"
    "      priceError: null,\n"
    "      pricingErrorCode: null,\n"
    "    };\n"
    "    setLines((current) => {\n"
    "      const sourceIndex = current.findIndex((line) => line.clientLineId === source.clientLineId);\n"
    "      if (sourceIndex < 0) return current;\n"
    "      const next = [...current];\n"
    "      next.splice(sourceIndex + 1, 0, split);\n"
    "      return next;\n"
    "    });\n"
    "    markDirty();\n"
    "    focusLinePrice(clientLineId);\n"
    "  }\n\n"
    "  async function addSku(option: SalesOrderSkuSearchOption) {",
)
replace_once(
    form,
    "    if (linesRef.current.some((line) => line.variantId === option.id)) return onError('SKU này đã có trong đơn');",
    "    if (linesRef.current.some((line) => line.variantId === option.id)) return onError('Hàng này đã có trong đơn. Dùng Tách dòng nếu cần thêm dòng riêng.');",
)
replace_once(
    form,
    "                      {expandedLineId === line.clientLineId ? 'Ẩn chi tiết' : 'Chi tiết'}\n"
    "                    </button>\n"
    "                  </div>",
    "                      {expandedLineId === line.clientLineId ? 'Ẩn chi tiết' : 'Chi tiết'}\n"
    "                    </button>\n"
    "                    <button\n"
    "                      type=\"button\"\n"
    "                      className={styles.linkButton}\n"
    "                      aria-label={`Tách dòng ${line.sku}`}\n"
    "                      title={canPriceOverride ? 'Tách dòng' : 'Cần quyền Sửa giá bán trên đơn'}\n"
    "                      disabled={!canPriceOverride}\n"
    "                      onClick={() => splitLine(index)}\n"
    "                    >\n"
    "                      <svg viewBox=\"0 0 20 20\" width=\"14\" height=\"14\" aria-hidden=\"true\" focusable=\"false\">\n"
    "                        <path d=\"M4 4v4c0 2 1.5 3 3.5 3H15M11 7l4 4-4 4M4 4h4\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"1.8\" strokeLinecap=\"round\" strokeLinejoin=\"round\" />\n"
    "                      </svg>\n"
    "                    </button>\n"
    "                  </div>",
)
replace_once(
    form,
    "            className={styles.directPriceInput}\n"
    "            aria-label={`Đơn giá ${line.sku}`}",
    "            className={styles.directPriceInput}\n"
    "            data-price-line-id={line.clientLineId}\n"
    "            aria-label={`Đơn giá ${line.sku}`}",
)

# 5) Real PostgreSQL transaction regression: two independent rows with same variant.
transaction = 'npp-core/api/test/sales-order-transaction.test.js'
replace_once(
    transaction,
    "      permissions: Object.freeze(['core.sales-order.discount.override']),",
    "      permissions: Object.freeze(['core.sales-order.discount.override', 'core.sales-order.price.override']),",
)
replace_once(
    transaction,
    "            lines: [{\n"
    "              variantId: fixture.variantId,\n"
    "              quantity: '2',\n"
    "              discountMode: 'TOTAL_AMOUNT',\n"
    "              discountValue: '500',\n"
    "              taxMode: 'EXCLUSIVE',\n"
    "              taxRate: '10',\n"
    "            }],",
    "            lines: [{\n"
    "              variantId: fixture.variantId,\n"
    "              quantity: '2',\n"
    "              discountMode: 'TOTAL_AMOUNT',\n"
    "              discountValue: '500',\n"
    "              taxMode: 'EXCLUSIVE',\n"
    "              taxRate: '10',\n"
    "            }, {\n"
    "              variantId: fixture.variantId,\n"
    "              quantity: '1',\n"
    "              manualUnitPriceMinor: '0',\n"
    "              discountMode: 'TOTAL_AMOUNT',\n"
    "              discountValue: '0',\n"
    "              taxMode: 'EXCLUSIVE',\n"
    "              taxRate: '10',\n"
    "            }],",
)
replace_once(
    transaction,
    "    assert.equal(transaction.salesOrder.status, 'draft');\n"
    "    assert.match(transaction.eventId, /^[0-9a-f-]{36}$/i);",
    "    assert.equal(transaction.salesOrder.status, 'draft');\n"
    "    const currentVersion = transaction.salesOrder.versions.at(-1);\n"
    "    assert.equal(currentVersion.lines.length, 2);\n"
    "    assert.equal(currentVersion.lines[0].variantId, currentVersion.lines[1].variantId);\n"
    "    assert.notEqual(currentVersion.lines[0].id, currentVersion.lines[1].id);\n"
    "    assert.equal(currentVersion.lines[1].unitPrice, '0');\n"
    "    assert.match(transaction.eventId, /^[0-9a-f-]{36}$/i);",
)

# 6) Source contract regression for migration + downstream lineage.
Path('npp-core/api/test/issue-791-lot-d-split-lines.test.js').write_text(
    "import test from 'node:test';\n"
    "import assert from 'node:assert/strict';\n"
    "import { readFile } from 'node:fs/promises';\n\n"
    "const migrationPath = new URL('../../../database/migrations/sales/115_sales_order_split_lines.sql', import.meta.url);\n"
    "const registryPath = new URL('../src/migrations/index.js', import.meta.url);\n"
    "const salesOrderPath = new URL('../src/services/sales-order-legacy.js', import.meta.url);\n"
    "const fulfillmentPath = new URL('../src/db/repositories/sales-fulfillment.js', import.meta.url);\n"
    "const fulfillmentMigrationPath = new URL('../../../database/migrations/sales/042_sales_fulfillment_reservation_demand.sql', import.meta.url);\n"
    "const deliveryMigrationPath = new URL('../../../database/migrations/sales/044_sales_delivery_order_handover.sql', import.meta.url);\n\n"
    "test('Issue #791 Lot D makes SKU product identity non-unique while preserving line identity', async () => {\n"
    "  const [migration, registry, service] = await Promise.all([readFile(migrationPath, 'utf8'), readFile(registryPath, 'utf8'), readFile(salesOrderPath, 'utf8')]);\n"
    "  assert.match(migration, /DROP CONSTRAINT IF EXISTS sales_order_version_lines_variant_unique/);\n"
    "  assert.match(migration, /CREATE INDEX IF NOT EXISTS sales_order_version_lines_variant_idx/);\n"
    "  assert.match(registry, /115_sales_order_split_lines/);\n"
    "  assert.doesNotMatch(service, /DUPLICATE_VARIANT/);\n"
    "  assert.doesNotMatch(service, /A SKU may only appear once in a Sales Order version/);\n"
    "});\n\n"
    "test('Issue #791 Lot D keeps fulfillment and delivery lineage on sales order line identity', async () => {\n"
    "  const [repository, fulfillmentMigration, deliveryMigration] = await Promise.all([readFile(fulfillmentPath, 'utf8'), readFile(fulfillmentMigrationPath, 'utf8'), readFile(deliveryMigrationPath, 'utf8')]);\n"
    "  assert.match(repository, /line\\.id AS sales_order_line_id/);\n"
    "  assert.match(repository, /data\\.salesOrderLineId/);\n"
    "  assert.match(fulfillmentMigration, /sales_order_fulfillment_demands_version_line_unique[\\s\\S]*sales_order_line_id/);\n"
    "  assert.match(deliveryMigration, /delivery_order_lines_sales_line_fk[\\s\\S]*sales_order_line_id/);\n"
    "  assert.match(deliveryMigration, /fulfillment_demand_id uuid NOT NULL/);\n"
    "});\n"
)

# 7) UI source regression.
Path('npp-core/web/test/issue-791-sales-line-split.test.mjs').write_text(
    "import test from 'node:test';\n"
    "import assert from 'node:assert/strict';\n"
    "import { readFile } from 'node:fs/promises';\n\n"
    "const formPath = new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url);\n\n"
    "test('Issue #791 exposes explicit Tách dòng instead of duplicate search Add', async () => {\n"
    "  const form = await readFile(formPath, 'utf8');\n"
    "  assert.match(form, /function splitLine\\(index: number\\)/);\n"
    "  assert.match(form, /manualUnitPriceMinor: '0'/);\n"
    "  assert.match(form, /quantity: '1'/);\n"
    "  assert.match(form, /discountValue: '0'/);\n"
    "  assert.match(form, /aria-label={`Tách dòng \\${line\\.sku}`}/);\n"
    "  assert.match(form, /Dùng Tách dòng nếu cần thêm dòng riêng/);\n"
    "  assert.match(form, /data-price-line-id={line\\.clientLineId}/);\n"
    "});\n"
)
