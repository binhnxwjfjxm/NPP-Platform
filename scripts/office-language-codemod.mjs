import { readFile, writeFile } from 'node:fs/promises';

const changes = [];

async function replaceRequired(path, replacements) {
  let source = await readFile(path, 'utf8');
  let count = 0;

  for (const [before, after] of replacements) {
    if (!source.includes(before)) {
      throw new Error(`${path}: expected source fragment was not found:\n${before}`);
    }
    source = source.split(before).join(after);
    count += 1;
  }

  await writeFile(path, source);
  changes.push(`${path}: ${count} replacement groups`);
}

await replaceRequired('npp-core/web/app/components/app-shell.tsx', [
  ["{ href: '/inventory/balances', label: 'Tồn kho',", "{ href: '/inventory/balances', label: 'Tra cứu tồn kho',"],
  ["{ href: '/inventory/opening-balances', label: 'Nhập tồn đầu kỳ',", "{ href: '/inventory/opening-balances', label: 'Thiết lập tồn đầu kỳ',"],
  ['<span className={styles.navHint}>Số liệu và tình trạng hệ thống</span>', '<span className={styles.navHint}>Thông tin tổng hợp phục vụ điều hành</span>'],
  ['<p className={styles.navLabel}>Danh mục nền tảng</p>', '<p className={styles.navLabel}>Danh mục quản lý</p>'],
  ["title={collapsed ? 'Tổ chức và kho hàng' : undefined}", "title={collapsed ? 'Danh mục nghiệp vụ' : undefined}"],
  ['<span className={styles.navTitle}>Tổ chức &amp; kho hàng</span>', '<span className={styles.navTitle}>Danh mục nghiệp vụ</span>'],
  ['<span className={styles.navHint}>Cơ cấu đơn vị và địa điểm lưu trữ</span>', '<span className={styles.navHint}>Tổ chức, đối tác, hàng hóa, giá và chứng từ</span>'],
  ['<span className={styles.navHint}>Số dư, lô, chính sách lô và nhập tồn đầu kỳ</span>', '<span className={styles.navHint}>Số lượng tồn, lô hàng, hạn dùng và tồn đầu kỳ</span>'],
  ['<small>Đăng nhập sẽ được bổ sung</small>', '<small>Quản lý tài khoản và quyền truy cập</small>'],
  [`            {actions}\n            <span className={styles.statusPill}>\n              <span className={styles.statusDot} aria-hidden="true" />\n              Hệ thống trực tuyến\n            </span>`, `            {actions}`],
]);

await replaceRequired('npp-core/web/app/access/users/user-workspace.tsx', [
  ['Quản lý tài khoản nội bộ liên kết với nhân sự. Tài khoản chưa phải thông tin đăng nhập thật và có thể tồn tại với tập vai trò trống.', 'Quản lý tài khoản sử dụng hệ thống, liên kết nhân sự và phân quyền theo công việc.'],
  ['Đã tạo người dùng với tập vai trò trống. Có thể gán vai trò bằng thao tác Sửa.', 'Đã tạo người dùng. Có thể phân quyền bằng thao tác Sửa.'],
  ['Đã vô hiệu hóa người dùng.', 'Đã ngừng sử dụng người dùng.'],
  ["user.is_active ? 'Vô hiệu' : 'Kích hoạt'", "user.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'"],
  ["toggleState.nextActive ? 'Kích hoạt' : 'Vô hiệu'", "toggleState.nextActive ? 'Đưa vào sử dụng' : 'Ngừng sử dụng'"],
]);

await replaceRequired('npp-core/web/app/pricing/pricing-workspace.tsx', [
  [`const ADJUSTMENT_LABELS: Record<PriceAdjustmentType, string> = {\n  FIXED_PRICE: 'Đặt giá trực tiếp', PERCENT_DISCOUNT: 'Giảm phần trăm', AMOUNT_DISCOUNT: 'Giảm số tiền',\n  PERCENT_MARKUP: 'Tăng phần trăm', AMOUNT_MARKUP: 'Tăng số tiền',\n};`, `const ADJUSTMENT_LABELS: Record<PriceAdjustmentType, string> = {\n  FIXED_PRICE: 'Đặt giá trực tiếp', PERCENT_DISCOUNT: 'Giảm phần trăm', AMOUNT_DISCOUNT: 'Giảm số tiền',\n  PERCENT_MARKUP: 'Tăng phần trăm', AMOUNT_MARKUP: 'Tăng số tiền',\n};\nconst SOURCE_LABELS: Record<PriceListItem['source_kind'], string> = {\n  ADMIN: 'Nhập trực tiếp', IMPORT: 'Nhập từ tệp', CODE: 'Thiết lập tự động',\n};\nconst RESOLUTION_STEP_LABELS: Record<PricingResolution['steps'][number]['kind'], string> = {\n  BASE: 'Giá cơ sở', RULE: 'Mức giá được áp dụng', SKIPPED: 'Mức giá không được áp dụng', MANUAL_OVERRIDE: 'Điều chỉnh trực tiếp',\n};\nconst RESOLUTION_REASON_LABELS: Record<string, string> = {\n  LOWER_PRIORITY_EXCLUSIVE: 'Đã có mức ưu tiên cao hơn được áp dụng',\n};\n\nfunction resolutionReasonLabel(reason?: string) {\n  if (!reason) return '';\n  return RESOLUTION_REASON_LABELS[reason] || reason;\n}`],
  ["setMessage(error instanceof Error ? error.message : 'Không thể phân giải giá');", "setMessage(error instanceof Error ? error.message : 'Không thể xác định giá áp dụng');"],
  ['<AppShell title="Giá bán & khuyến mãi" subtitle="Giá nền theo SKU, giá kênh, nhóm khách, khách cụ thể và chương trình — hoàn toàn quản trị bằng dữ liệu.">', '<AppShell title="Giá bán & khuyến mãi" subtitle="Quản lý giá bán theo hàng hóa, kênh bán, nhóm khách hàng, khách hàng và chương trình áp dụng.">'],
  ["['resolver', 'Thử giá']", "['resolver', 'Kiểm tra giá áp dụng']"],
  ['<div><h2>Kênh bán</h2><p>Ví dụ: bán lẻ, quán/café, đại lý, online.</p></div>', '<div><h2>Kênh bán</h2><p>Phân nhóm hình thức bán hàng để áp dụng bảng giá phù hợp.</p></div>'],
  ['<div><h2>Bảng giá & chương trình</h2><p>Priority càng lớn càng được xét trước; giá không nằm trong code.</p></div>', '<div><h2>Bảng giá & chương trình</h2><p>Thứ tự ưu tiên lớn hơn được xét trước. Mọi mức giá được quản lý trực tiếp trên hệ thống.</p></div>'],
  ['<thead><tr><th>Mã</th><th>Loại</th><th>Phạm vi</th><th>Priority</th><th>Xử lý</th><th>Trạng thái</th><th></th></tr></thead>', '<thead><tr><th>Mã</th><th>Loại</th><th>Phạm vi</th><th>Thứ tự ưu tiên</th><th>Cách áp dụng</th><th>Trạng thái</th><th></th></tr></thead>'],
  ["{list.stacking_mode === 'STACKABLE' ? 'Cộng dồn' : 'Độc quyền'}{list.stop_processing ? ' · Dừng' : ''}", "{list.stacking_mode === 'STACKABLE' ? 'Có thể kết hợp' : 'Chỉ áp dụng một mức'}{list.stop_processing ? ' · Không xét tiếp' : ''}"],
  ["{channel.is_active ? 'Vô hiệu' : 'Kích hoạt'}", "{channel.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ["{list.is_active ? 'Vô hiệu' : 'Kích hoạt'}", "{list.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ["{item.is_active ? 'Vô hiệu' : 'Kích hoạt'}", "{item.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ['<div><h2>Giá/quy tắc theo SKU</h2><p>Giá lẻ và giá thùng được nhập riêng trên đúng SKU.</p></div>', '<div><h2>Mức giá theo SKU</h2><p>Giá lẻ và giá thùng được nhập riêng cho từng SKU.</p></div>'],
  ['<thead><tr><th>SKU</th><th>Quy tắc</th><th>Giá trị</th><th>Bậc số lượng</th><th>Nguồn</th><th>Trạng thái</th><th></th></tr></thead>', '<thead><tr><th>SKU</th><th>Cách áp dụng</th><th>Giá trị</th><th>Khoảng số lượng</th><th>Nguồn thiết lập</th><th>Trạng thái</th><th></th></tr></thead>'],
  ["<td>{item.source_kind}{item.external_rule_code ? ` · ${item.external_rule_code}` : ''}</td>", "<td>{SOURCE_LABELS[item.source_kind]}{item.external_rule_code ? ` · ${item.external_rule_code}` : ''}</td>"],
  ['<div><h2>Thử giá & giải thích</h2><p>Chọn ngữ cảnh để xem giá nền, rule áp dụng, rule bị bỏ qua và giá cuối.</p></div>', '<div><h2>Kiểm tra giá áp dụng</h2><p>Chọn hàng hóa, số lượng và đối tượng bán để xem mức giá cuối cùng cùng lý do áp dụng.</p></div>'],
  ['<label>Nhóm khách<select value={resolver.customerGroupId} onChange={(event) => setResolver({ ...resolver, customerGroupId: event.target.value })}><option value="">Tự suy ra/không chọn</option>', '<label>Nhóm khách<select value={resolver.customerGroupId} onChange={(event) => setResolver({ ...resolver, customerGroupId: event.target.value })}><option value="">Theo khách hàng đã chọn / để trống</option>'],
  ['<label>Giá chỉnh tay (₫)<input', '<label>Giá điều chỉnh trực tiếp (₫)<input'],
  ['<label>Lý do chỉnh tay<input', '<label>Lý do điều chỉnh<input'],
  ['data-testid="resolve-price-button">Phân giải giá</button>', 'data-testid="resolve-price-button">Xem giá áp dụng</button>'],
  ['<h3>Trace áp giá</h3>', '<h3>Quá trình xác định giá</h3>'],
  ['<strong>{step.kind}</strong>', '<strong>{RESOLUTION_STEP_LABELS[step.kind]}</strong>'],
  ["{step.reason ? `· ${step.reason}` : ''}", "{step.reason ? `· ${resolutionReasonLabel(step.reason)}` : ''}"],
  ['<label>Priority<input type="number"', '<label>Thứ tự ưu tiên<input type="number"'],
  ['<label>Xử lý<select value={listForm.stackingMode}', '<label>Cách áp dụng<select value={listForm.stackingMode}'],
  ['<option value="EXCLUSIVE">Độc quyền</option><option value="STACKABLE">Được cộng dồn</option>', '<option value="EXCLUSIVE">Chỉ áp dụng một mức</option><option value="STACKABLE">Có thể kết hợp</option>'],
  [' /> Dừng sau khi áp</label>', ' /> Không xét các mức sau khi áp dụng</label>'],
  ['<label>Mã rule ngoài<input', '<label>Mã tham chiếu<input'],
]);

await replaceRequired('npp-core/web/test/ui-live-fixes.test.js', [
  ["assert.match(workspace, /Tài khoản chưa phải thông tin đăng nhập thật/);", "assert.match(workspace, /Quản lý tài khoản sử dụng hệ thống/);"],
]);

console.log(changes.join('\n'));
