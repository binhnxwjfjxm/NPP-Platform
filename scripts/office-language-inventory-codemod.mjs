import { readFile, writeFile } from 'node:fs/promises';

async function replaceRequired(path, replacements) {
  let source = await readFile(path, 'utf8');
  for (const [before, after] of replacements) {
    if (!source.includes(before)) throw new Error(`${path}: missing fragment\n${before}`);
    source = source.split(before).join(after);
  }
  await writeFile(path, source);
}

async function replaceRegexRequired(path, pattern, replacement) {
  let source = await readFile(path, 'utf8');
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`${path}: expected exactly one regex match for ${pattern}, found ${matches?.length ?? 0}`);
  source = source.replace(pattern, replacement);
  await writeFile(path, source);
}

await replaceRequired('npp-core/web/app/inventory/balances/page.tsx', [
  ["import BusinessLanguageBoundary from '../../components/business-language-boundary';\n", ''],
  [`  return (\n    <BusinessLanguageBoundary scope="inventory">\n      <InventoryWorkspace\n        scope="balances"\n        title="Tra cứu tồn kho"\n        subtitle="Xem số lượng hiện tại, khả dụng, đang giữ và vị trí hàng theo dữ liệu thực tế của hệ thống."\n        initialSnapshot={initialData}\n        initialError={initialError}\n      />\n    </BusinessLanguageBoundary>\n  );`, `  return (\n    <InventoryWorkspace\n      scope="balances"\n      title="Tra cứu tồn kho"\n      subtitle="Xem số lượng hiện tại, khả dụng, đang giữ và vị trí hàng theo dữ liệu thực tế của hệ thống."\n      initialSnapshot={initialData}\n      initialError={initialError}\n    />\n  );`],
]);

await replaceRequired('npp-core/web/app/inventory/lots/page.tsx', [
  ["import BusinessLanguageBoundary from '../../components/business-language-boundary';\n", ''],
  [`  return (\n    <BusinessLanguageBoundary scope="inventory">\n      <InventoryWorkspace\n        scope="lots"\n        title="Lô hàng"\n        subtitle="Theo dõi mã lô, ngày sản xuất, hạn sử dụng và thông tin liên quan của từng SKU cơ sở."\n        initialSnapshot={initialData}\n        initialError={initialError}\n      />\n    </BusinessLanguageBoundary>\n  );`, `  return (\n    <InventoryWorkspace\n      scope="lots"\n      title="Lô hàng"\n      subtitle="Theo dõi mã lô, ngày sản xuất, hạn sử dụng và thông tin liên quan của từng SKU."\n      initialSnapshot={initialData}\n      initialError={initialError}\n    />\n  );`],
]);

await replaceRequired('npp-core/web/app/inventory/tracking-policies/page.tsx', [
  ["import BusinessLanguageBoundary from '../../components/business-language-boundary';\n", ''],
  ["import InventoryLot3Boundary from '../inventory-lot3-boundary';\n", ''],
  [`  return (\n    <BusinessLanguageBoundary scope="inventory">\n      <InventoryLot3Boundary scope="tracking-policies">\n        <InventoryWorkspace\n          scope="tracking-policies"\n          title="Chính sách quản lý lô"\n          subtitle="Chọn cách quản lý lô, hạn sử dụng và vị trí cho từng SKU theo đúng khả năng backend hiện có."\n          initialSnapshot={initialData}\n          initialError={initialError}\n        />\n      </InventoryLot3Boundary>\n    </BusinessLanguageBoundary>\n  );`, `  return (\n    <InventoryWorkspace\n      scope="tracking-policies"\n      title="Chính sách quản lý lô"\n      subtitle="Chọn cách quản lý lô, hạn sử dụng và vị trí cho từng SKU."\n      initialSnapshot={initialData}\n      initialError={initialError}\n    />\n  );`],
]);

await replaceRequired('npp-core/web/app/pricing/page.tsx', [
  ["import BusinessLanguageBoundary from '../components/business-language-boundary';\n", ''],
  [`    <PricingIdempotencyBoundary>\n      <BusinessLanguageBoundary scope="pricing">\n        <PricingWorkspace />\n      </BusinessLanguageBoundary>\n    </PricingIdempotencyBoundary>`, `    <PricingIdempotencyBoundary>\n      <PricingWorkspace />\n    </PricingIdempotencyBoundary>`],
]);

await replaceRequired('npp-core/web/app/document-numbering/page.tsx', [
  ["import BusinessLanguageBoundary from '../components/business-language-boundary';\n", ''],
  [`  return (\n    <BusinessLanguageBoundary scope="document-numbering">\n      <DocumentNumberingWorkspace />\n    </BusinessLanguageBoundary>\n  );`, `  return <DocumentNumberingWorkspace />;`],
]);

await replaceRequired('npp-core/web/app/inventory/inventory-workspace.tsx', [
  [`function policyLabel(policy: InventoryTrackingPolicy): string {\n  return \`${'${policy.base_sku}${policy.base_variant_name ? ` — ${policy.base_variant_name}` : \'\'}'}\`;\n}`, `function policyLabel(policy: InventoryTrackingPolicy): string {\n  return \`${'${policy.base_sku}${policy.base_variant_name ? ` — ${policy.base_variant_name}` : \'\'}'}\`;\n}\n\nfunction lotTrackingLabel(value: InventoryTrackingPolicy['lot_tracking_mode']) {\n  return value === 'REQUIRED' ? 'Bắt buộc quản lý theo lô' : 'Không quản lý theo lô';\n}\n\nfunction expiryTrackingLabel(value: InventoryTrackingPolicy['expiry_tracking_mode']) {\n  if (value === 'REQUIRED') return 'Bắt buộc nhập hạn sử dụng';\n  if (value === 'OPTIONAL') return 'Có thể nhập hạn sử dụng';\n  return 'Không quản lý hạn sử dụng';\n}\n\nfunction movementDirectionLabel(value: InventoryMovementLine['direction']) {\n  return value === 'IN' ? 'Nhập kho' : 'Xuất kho';\n}`],
  ["? 'Bảng điều khiển này bám dữ liệu thật từ Core API: số dư, lô, chính sách và nhập tồn đầu kỳ.'", "? 'Tổng hợp số lượng tồn, lô hàng, chính sách quản lý và lịch sử nhập tồn đầu kỳ.'"],
  ["? 'Xem số dư chính xác theo kho, vị trí, SKU cơ sở, lô và hạn dùng. Mở chi tiết lấy trực tiếp từ sổ cái tồn kho.'", "? 'Xem số lượng theo kho, vị trí, SKU, lô và hạn dùng. Chọn một dòng để xem lịch sử biến động.'"],
  ["? 'Quy tắc lô, hạn dùng và vị trí được lưu với cập nhật lạc quan và ghi nhận nghiệp vụ thật.'", "? 'Thiết lập yêu cầu quản lý lô, hạn sử dụng và vị trí cho từng SKU.'"],
  ["? 'Danh sách lô chuẩn được dùng lại khi ghi sổ mở tồn và truy vết tồn kho.'", "? 'Danh sách lô hàng đã được ghi nhận để tra cứu và theo dõi hạn sử dụng.'"],
  [": 'Nhập tồn đầu kỳ nhận JSON chuẩn hóa, kiểm tra trước, rồi ghi sổ nguyên tử vào sổ cái tồn kho.';", ": 'Nhập dữ liệu tồn đầu kỳ từ tệp, kiểm tra trước rồi xác nhận ghi nhận.';"],
  ['<p className={styles.kicker}>Giai đoạn 4.4</p>', '<p className={styles.kicker}>Quản lý tồn kho</p>'],
  ['<p className={styles.cardHint}>Lô canonical theo SKU cơ sở.</p>', '<p className={styles.cardHint}>Các lô hàng đang được theo dõi theo SKU.</p>'],
  ['SKU cơ sở', 'SKU'],
  ['<span className={styles.pill}>{line.direction}</span>', '<span className={styles.pill}>{movementDirectionLabel(line.direction)}</span>'],
  ["<div>{joinValues(line.warehouse_id, line.location_id ?? '—', line.source_line_reference)}</div>", "<div>{line.source_line_reference ? `Tham chiếu: ${line.source_line_reference}` : 'Biến động tồn kho'}</div>"],
  ['<td><span className={styles.pill}>{policy.lot_tracking_mode}</span></td>', '<td><span className={styles.pill}>{lotTrackingLabel(policy.lot_tracking_mode)}</span></td>'],
  ['<td><span className={styles.pill}>{policy.expiry_tracking_mode}</span></td>', '<td><span className={styles.pill}>{expiryTrackingLabel(policy.expiry_tracking_mode)}</span></td>'],
  ['<span>Mã biến thể cơ sở</span>', '<span>Mã tham chiếu hàng hóa</span>'],
  ['placeholder="UUID biến thể cơ sở"', 'placeholder="Nhập mã tham chiếu của SKU"'],
  ['<option value="NONE">NONE</option>\n                    <option value="REQUIRED">REQUIRED</option>', '<option value="NONE">Không quản lý theo lô</option>\n                    <option value="REQUIRED">Bắt buộc quản lý theo lô</option>'],
  ['<option value="NONE">NONE</option>\n                    <option value="OPTIONAL">OPTIONAL</option>\n                    <option value="REQUIRED">REQUIRED</option>', '<option value="NONE">Không quản lý hạn sử dụng</option>\n                    <option value="OPTIONAL">Có thể nhập hạn sử dụng</option>\n                    <option value="REQUIRED">Bắt buộc nhập hạn sử dụng</option>'],
  ['<span>Phiên bản dự kiến</span>', '<span>Lần cập nhật</span>'],
  ['placeholder="Để trống khi tạo mới"', 'placeholder="Tự điền khi chọn chính sách"'],
  ['<p className={styles.sectionCopy}>Danh sách lô chuẩn theo SKU, có hạn dùng và metadata.</p>', '<p className={styles.sectionCopy}>Danh sách lô hàng theo SKU, ngày sản xuất, hạn sử dụng và thông tin nguồn.</p>'],
]);

await replaceRegexRequired(
  'npp-core/web/app/inventory/inventory-workspace.tsx',
  /        <section className=\{styles\.section\} id="opening-balances"[\s\S]*?        <\/section>\n      <\/div>/,
  `        <section className={styles.section} id="opening-balances" data-testid="inventory-opening-section">\n          <div className={styles.sectionHeader}>\n            <div className={styles.sectionTitleBlock}>\n              <h2 className={styles.sectionTitle}>Thiết lập tồn đầu kỳ</h2>\n              <p className={styles.sectionCopy}>Tải tệp mẫu, điền dữ liệu bằng Excel, kiểm tra và xác nhận trước khi ghi nhận.</p>\n            </div>\n            <Link href="/inventory/opening-balances" className={styles.primaryAction}>Mở màn hình nhập tồn đầu kỳ</Link>\n          </div>\n          <div className={styles.panel}>\n            <h3 className={styles.panelTitle}>Lịch sử nhập tồn đầu kỳ</h3>\n            <div className={styles.tableWrap}>\n              <table className={styles.table}>\n                <thead><tr><th>Mã đợt</th><th>Tệp nguồn</th><th>Số dòng</th><th>Thời gian</th></tr></thead>\n                <tbody>\n                  {filteredImports.length === 0 ? tableEmpty('Chưa có lần nhập nào.') : filteredImports.map((item) => (\n                    <tr key={item.id} data-testid={\`inventory-opening-row-${'${item.source_key}'}\`}>\n                      <td><strong>{item.source_key}</strong></td>\n                      <td>{item.source_filename ?? '—'}</td>\n                      <td>{item.row_count}</td>\n                      <td>{formatDateTime(item.created_at)}</td>\n                    </tr>\n                  ))}\n                </tbody>\n              </table>\n            </div>\n          </div>\n        </section>\n      </div>`,
);

await replaceRequired('npp-core/web/app/inventory/opening-balances/opening-balance-csv-workspace.tsx', [
  ["const HEADERS = ['warehouseId', 'locationId', 'sourceVariantId', 'sourceQuantity', 'lotCode', 'manufacturedDate', 'expiryDate', 'supplierLotReference', 'sourceLineReference'];", `const CSV_COLUMNS = [\n  { key: 'warehouseId', label: 'Mã kho' },\n  { key: 'locationId', label: 'Mã vị trí' },\n  { key: 'sourceVariantId', label: 'Mã tham chiếu SKU' },\n  { key: 'sourceQuantity', label: 'Số lượng' },\n  { key: 'lotCode', label: 'Mã lô' },\n  { key: 'manufacturedDate', label: 'Ngày sản xuất' },\n  { key: 'expiryDate', label: 'Hạn sử dụng' },\n  { key: 'supplierLotReference', label: 'Mã lô nhà cung cấp' },\n  { key: 'sourceLineReference', label: 'Tham chiếu dòng' },\n] as const;\nconst HEADERS = CSV_COLUMNS.map((column) => column.key);\nconst HEADER_ALIASES = Object.fromEntries(CSV_COLUMNS.flatMap((column) => [[column.label, column.key], [column.key, column.key]]));`],
  ['const headers = parseLine(lines[0]);', 'const headers = parseLine(lines[0]).map((header) => HEADER_ALIASES[header.trim()] ?? header.trim());'],
  [`  const content = [\n    HEADERS.join(','),\n    'WAREHOUSE_UUID,,VARIANT_UUID,10,LO-001,2026-01-01,2027-01-01,LO-NCC-01,Dong-2',\n  ].join('\\n');`, `  const content = CSV_COLUMNS.map((column) => column.label).join(',');`],
  ['placeholder="Ví dụ: TON_DAU_2026"', 'placeholder="Mã đợt nhập"'],
  ['<span>Tải tệp mẫu</span><button type="button" onClick={downloadTemplate}>Tải mẫu CSV</button>', '<span>Tải tệp mẫu</span><button type="button" onClick={downloadTemplate}>Tải mẫu Excel/CSV</button>'],
  ['<span>Chọn tệp đã điền</span><label>Chọn CSV<input', '<span>Chọn tệp đã điền</span><label>Chọn tệp<input'],
]);

console.log('Inventory office-language codemod completed');
