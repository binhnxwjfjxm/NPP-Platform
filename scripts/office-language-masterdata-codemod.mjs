import { readFile, writeFile } from 'node:fs/promises';

async function replaceRequired(path, replacements) {
  let source = await readFile(path, 'utf8');
  for (const [before, after] of replacements) {
    if (!source.includes(before)) throw new Error(`${path}: missing fragment\n${before}`);
    source = source.split(before).join(after);
  }
  await writeFile(path, source);
}

await replaceRequired('npp-core/web/app/products/product-workspace.tsx', [
  [`const EMPTY_VARIANT: VariantForm = {\n  sku: '', name: '', variantKind: 'BASE', isInventoryBase: false,\n  isSellable: true, isCatalogVisible: false, isActive: true,\n};`, `const EMPTY_VARIANT: VariantForm = {\n  sku: '', name: '', variantKind: 'BASE', isInventoryBase: false,\n  isSellable: true, isCatalogVisible: false, isActive: true,\n};\n\nconst VARIANT_KIND_LABELS: Record<ProductVariant['variant_kind'], string> = {\n  BASE: 'Đơn vị lẻ',\n  CARTON: 'Thùng',\n  OTHER: 'Quy cách khác',\n};`],
  ["setNotice(isActive ? 'Đã kích hoạt sản phẩm' : 'Đã vô hiệu sản phẩm');", "setNotice(isActive ? 'Đã đưa sản phẩm vào sử dụng' : 'Đã ngừng sử dụng sản phẩm');"],
  ["setNotice(isActive ? 'Đã kích hoạt loại sản phẩm' : 'Đã vô hiệu loại sản phẩm');", "setNotice(isActive ? 'Đã đưa loại sản phẩm vào sử dụng' : 'Đã ngừng sử dụng loại sản phẩm');"],
  ["setNotice(isActive ? 'Đã kích hoạt nhãn hàng' : 'Đã vô hiệu nhãn hàng');", "setNotice(isActive ? 'Đã đưa nhãn hàng vào sử dụng' : 'Đã ngừng sử dụng nhãn hàng');"],
  ['<AppShell title="Danh mục sản phẩm" subtitle="Sản phẩm, loại, nhãn hàng và SKU" kicker="NPP Product Catalog">', '<AppShell title="Danh mục sản phẩm" subtitle="Quản lý sản phẩm, loại sản phẩm, nhãn hàng, SKU và thông tin bán hàng" kicker="Quản lý hàng hóa">'],
  ['<option value="all">Tất cả hiển thị</option><option value="visible">Hiện catalog</option><option value="hidden">Ẩn catalog</option>', '<option value="all">Tất cả hiển thị</option><option value="visible">Hiển thị bán hàng</option><option value="hidden">Không hiển thị bán hàng</option>'],
  ['<th>Catalog</th>', '<th>Hiển thị bán hàng</th>'],
  ["{product.is_active ? 'Vô hiệu' : 'Kích hoạt'}", "{product.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ['<div className={styles.sectionHeader}><div><h3>SKU của {selectedProduct.code}</h3><p>Quản lý SKU, đơn vị, quy đổi và barcode của sản phẩm.</p></div>', '<div className={styles.sectionHeader}><div><h3>SKU của {selectedProduct.code}</h3><p>Quản lý SKU, đơn vị tính, quy đổi và mã vạch của sản phẩm.</p></div>'],
  ['<td>{variant.variant_kind}</td>', '<td>{VARIANT_KIND_LABELS[variant.variant_kind]}</td>'],
  ['<th>Catalog</th>', '<th>Hiển thị bán hàng</th>'],
  ['<div className={styles.sectionHeader}><div><h2>Loại sản phẩm</h2><p>Phân nhóm cho bộ lọc admin và catalog khách hàng.</p></div>', '<div className={styles.sectionHeader}><div><h2>Loại sản phẩm</h2><p>Phân nhóm sản phẩm để quản lý và hỗ trợ khách hàng tra cứu.</p></div>'],
  ["{category.is_active ? 'Vô hiệu' : 'Kích hoạt'}", "{category.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ['<div className={styles.sectionHeader}><div><h2>Nhãn hàng</h2><p>Thương hiệu chuẩn gắn với sản phẩm.</p></div>', '<div className={styles.sectionHeader}><div><h2>Nhãn hàng</h2><p>Quản lý nhãn hàng được sử dụng thống nhất cho sản phẩm.</p></div>'],
  ["{brand.is_active ? 'Vô hiệu' : 'Kích hoạt'}", "{brand.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ['description="Thông tin sản phẩm dùng chung cho catalog, bán hàng và tồn kho."', 'description="Thông tin sản phẩm dùng chung cho bán hàng và quản lý tồn kho."'],
  ['<label>Tên catalog<input', '<label>Tên hiển thị bán hàng<input'],
  [' /> Hiện trên catalog</label>', ' /> Hiển thị trong danh mục bán hàng</label>'],
  ['description="SKU xác định đơn vị bán, đơn vị tồn chuẩn và khả năng hiển thị trên catalog."', 'description="SKU xác định đơn vị bán, đơn vị tồn chuẩn và khả năng hiển thị trong danh mục bán hàng."'],
  [' /> Hiện catalog</label>', ' /> Hiển thị trong danh mục bán hàng</label>'],
  ['description="Loại sản phẩm phục vụ phân nhóm quản trị và catalog khách hàng."', 'description="Loại sản phẩm phục vụ phân nhóm quản lý và hỗ trợ khách hàng tra cứu."'],
  ['description="Nhãn hàng chuẩn được dùng thống nhất trên sản phẩm và catalog."', 'description="Nhãn hàng được dùng thống nhất cho sản phẩm và danh mục bán hàng."'],
]);

await replaceRequired('npp-core/web/app/products/product-unit-workspace.tsx', [
  ['<div><span className={styles.eyebrow}>Phase 3.3D</span><h1>Đơn vị, quy đổi &amp; barcode</h1><p>Tồn kho luôn quy về SKU gốc; hệ số được cấu hình riêng cho từng SKU.</p></div>', '<div><span className={styles.eyebrow}>Quản lý hàng hóa</span><h1>Đơn vị tính, quy đổi &amp; mã vạch</h1><p>Số lượng tồn được quy đổi về đơn vị tồn chuẩn; hệ số được thiết lập riêng cho từng SKU.</p></div>'],
  ['<div><h2>Quy đổi theo SKU</h2><p>Chọn sản phẩm và SKU để gắn đơn vị, hệ số và barcode.</p></div>', '<div><h2>Quy đổi theo SKU</h2><p>Chọn sản phẩm và SKU để thiết lập đơn vị tính, hệ số quy đổi và mã vạch.</p></div>'],
]);

await replaceRequired('npp-core/web/app/products/product-unit-admin.tsx', [
  [`const EMPTY_VARIANT_UNIT: VariantUnitForm = {\n  unitId: '', conversionToBase: '1', isPurchasable: true,\n  netContentValue: '', netContentUnitCode: 'G', sourceUnitLabel: '', sourcePackageDescription: '',\n};`, `const EMPTY_VARIANT_UNIT: VariantUnitForm = {\n  unitId: '', conversionToBase: '1', isPurchasable: true,\n  netContentValue: '', netContentUnitCode: 'G', sourceUnitLabel: '', sourcePackageDescription: '',\n};\n\nconst UNIT_KIND_LABELS: Record<UnitOfMeasure['unit_kind'], string> = {\n  COUNT: 'Đơn vị đếm', PACKAGE: 'Bao gói', WEIGHT: 'Khối lượng', VOLUME: 'Thể tích', OTHER: 'Loại khác',\n};\nconst BARCODE_TYPE_LABELS: Record<ProductBarcode['barcode_type'], string> = {\n  EAN13: 'EAN-13', EAN8: 'EAN-8', UPC_A: 'UPC-A', CODE128: 'Code 128', INTERNAL: 'Mã nội bộ', OTHER: 'Loại khác',\n};`],
  ['<td>{unit.unit_kind}</td>', '<td>{UNIT_KIND_LABELS[unit.unit_kind]}</td>'],
  ["{unit.is_active ? 'Vô hiệu' : 'Kích hoạt'}", "{unit.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ["setBarcodes((current) => [...current, saved]); setBarcode(''); setMessage('Đã thêm barcode');", "setBarcodes((current) => [...current, saved]); setBarcode(''); setMessage('Đã thêm mã vạch');"],
  ["'Không thể thêm barcode'", "'Không thể thêm mã vạch'"],
  ["'Không thể đổi trạng thái barcode'", "'Không thể đổi trạng thái mã vạch'"],
  ['<div className={styles.sectionHeader}><div><h3>Đơn vị &amp; barcode — {variant.sku}</h3><p>Tồn kho chuẩn hóa theo SKU gốc; hệ số không lấy từ khối lượng bao bì.</p></div></div>', '<div className={styles.sectionHeader}><div><h3>Đơn vị tính &amp; mã vạch — {variant.sku}</h3><p>Số lượng tồn được quy đổi về đơn vị tồn chuẩn; khối lượng bao bì chỉ dùng để mô tả sản phẩm.</p></div></div>'],
  ['<label>ĐVT mô tả<select', '<label>Đơn vị khối lượng/dung tích<select'],
  ['<option>G</option><option>KG</option><option>ML</option><option>L</option><option>EA</option><option>OTHER</option>', '<option value="G">Gam</option><option value="KG">Kilôgam</option><option value="ML">Mililít</option><option value="L">Lít</option><option value="EA">Cái</option><option value="OTHER">Đơn vị khác</option>'],
  ['<label>Nhãn nguồn<input', '<label>Tên đơn vị trên chứng từ nguồn<input'],
  ['<label className={styles.wide}>Quy cách nguồn<input', '<label className={styles.wide}>Quy cách đóng gói trên chứng từ nguồn<input'],
  ['aria-label="Số lượng thử"', 'aria-label="Số lượng cần quy đổi"'],
  ['data-testid="normalize-quantity-button">Thử quy đổi</button>', 'data-testid="normalize-quantity-button">Kiểm tra quy đổi</button>'],
  ['placeholder="Barcode / mã nội bộ"', 'placeholder="Mã vạch hoặc mã nội bộ"'],
  ['data-testid="add-barcode-button">Thêm barcode</button>', 'data-testid="add-barcode-button">Thêm mã vạch</button>'],
  ['<th>Barcode</th>', '<th>Mã vạch</th>'],
  ['<td>{item.barcode_type}</td>', '<td>{BARCODE_TYPE_LABELS[item.barcode_type]}</td>'],
  ["{item.is_active ? 'Vô hiệu' : 'Kích hoạt'}", "{item.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ['Chưa có barcode', 'Chưa có mã vạch'],
]);

await replaceRequired('npp-core/web/app/access/roles/role-workspace.tsx', [
  [`function permissionLabel(permission: AccessPermission) {\n  return \`${'${permission.label} · ${permission.permission_key}'}\`;\n}`, `const MODULE_LABELS: Record<string, string> = {\n  organization: 'Tổ chức và kho hàng', access: 'Nhân sự và phân quyền', customers: 'Khách hàng', suppliers: 'Nhà cung cấp',\n  products: 'Sản phẩm', pricing: 'Giá bán và khuyến mãi', inventory: 'Tồn kho và lô hàng', document_numbering: 'Số chứng từ',\n  sales: 'Bán hàng', purchasing: 'Mua hàng', accounting: 'Kế toán', reporting: 'Báo cáo',\n};\n\nfunction moduleLabel(module: string) {\n  return MODULE_LABELS[module] || 'Nhóm chức năng khác';\n}`],
  ['subtitle="Quản lý vai trò quản trị, trạng thái hoạt động và tập quyền theo module cho NPP Core."', 'subtitle="Quản lý vai trò, trạng thái sử dụng và phạm vi quyền theo công việc."'],
  ['kicker="Quản trị hệ thống · Phân quyền"', 'kicker="Phân quyền"'],
  ['<small>Toàn bộ vai trò trong installation hiện tại</small>', '<small>Toàn bộ vai trò đang được quản lý</small>'],
  ['<small>Quyền chuẩn hóa theo registry canonical</small>', '<small>Danh mục quyền có thể phân công cho vai trò</small>'],
  ["{role.is_active ? 'Ngừng dùng' : 'Kích hoạt'}", "{role.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ['<p className={styles.panelKicker}>Ma trận quyền</p>', '<p className={styles.panelKicker}>Phạm vi quyền</p>'],
  ['<h2>Chọn quyền theo module</h2>', '<h2>Chọn quyền theo nhóm chức năng</h2>'],
  ['<strong>{group.module}</strong>', '<strong>{moduleLabel(group.module)}</strong>'],
  ['                              <span className={matrixStyles.permissionKey}>{permission.permission_key}</span>\n', ''],
  ['                              <span className={matrixStyles.permissionMeta}>{permission.description}</span>\n', ''],
  ["<h3>{toggleState.nextActive ? 'Kích hoạt vai trò' : 'Ngừng hoạt động'}</h3>", "<h3>{toggleState.nextActive ? 'Đưa vai trò vào sử dụng' : 'Ngừng sử dụng vai trò'}</h3>"],
]);

await replaceRequired('npp-core/web/app/access/employees/employee-workspace.tsx', [
  ['subtitle="Quản lý hồ sơ nhân sự nghiệp vụ và đơn vị công tác trước khi liên kết tài khoản, vai trò và phạm vi quyền."', 'subtitle="Quản lý hồ sơ nhân sự, chức danh, thông tin liên hệ và đơn vị công tác."'],
  ['kicker="Quản trị hệ thống · Nhân sự"', 'kicker="Nhân sự"'],
  ['<small>Toàn bộ nhân sự trong installation hiện tại</small>', '<small>Toàn bộ hồ sơ nhân sự đang được quản lý</small>'],
  ["toggleState.nextActive ? 'Nhân sự đã được kích hoạt.' : 'Nhân sự đã được ngừng hoạt động.'", "toggleState.nextActive ? 'Nhân sự đã được đưa vào sử dụng.' : 'Nhân sự đã ngừng làm việc.'"],
]);

await replaceRequired('npp-core/web/app/customers/customer-workspace.tsx', [
  ['Dữ liệu đã thay đổi ở nơi khác. Danh sách đã được tải lại, anh vui lòng kiểm tra rồi thao tác lại.', 'Dữ liệu đã thay đổi ở nơi khác. Danh sách đã được tải lại. Vui lòng kiểm tra và thao tác lại.'],
  ['kicker="NPP Core · Dữ liệu nền"', 'kicker="Quản lý khách hàng"'],
  ['<small>Sẵn sàng sử dụng nghiệp vụ</small>', '<small>Hồ sơ đang được sử dụng</small>'],
  ['<small>Được giữ lại, không xóa cứng</small>', '<small>Hồ sơ đã ngừng sử dụng</small>'],
  ['<span>{customer.payment_terms_days} ngày · Hạn mức không phải công nợ</span>', '<span>Thời hạn thanh toán: {customer.payment_terms_days} ngày · Hạn mức tín dụng</span>'],
  ["{customer.is_active ? 'Ngừng' : 'Kích hoạt'}", "{customer.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ["{group.is_active ? 'Ngừng' : 'Kích hoạt'}", "{group.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ['<label className={customerStyles.fullWidth}>Địa chỉ dòng 1<input', '<label className={customerStyles.fullWidth}>Số nhà, tên đường<input'],
  ['<label className={customerStyles.fullWidth}>Địa chỉ dòng 2<input', '<label className={customerStyles.fullWidth}>Tòa nhà, tầng, phòng (nếu có)<input'],
  ["{address.is_active ? 'Ngừng' : 'Kích hoạt'}", "{address.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
]);

await replaceRequired('npp-core/web/app/suppliers/supplier-workspace.tsx', [
  ['Dữ liệu đã thay đổi ở nơi khác. Danh sách đã được tải lại, anh vui lòng kiểm tra rồi thao tác lại.', 'Dữ liệu đã thay đổi ở nơi khác. Danh sách đã được tải lại. Vui lòng kiểm tra và thao tác lại.'],
  ['<button type="button" onClick={() => void loadAll()} disabled={busy !== null}>Tải lại</button>', '<button type="button" onClick={() => void loadAll()} disabled={busy !== null}>Cập nhật dữ liệu</button>'],
  ["{supplier.is_active ? 'Vô hiệu' : 'Kích hoạt'}", "{supplier.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ["supplier.is_active ? 'Nhà cung cấp đã được ngừng hoạt động.' : 'Nhà cung cấp đã được kích hoạt.'", "supplier.is_active ? 'Nhà cung cấp đã ngừng sử dụng.' : 'Nhà cung cấp đã được đưa vào sử dụng.'"],
]);

await replaceRequired('npp-core/web/app/dashboard/page.tsx', [
  ['title="Tổng quan"', 'title="Tổng quan cơ cấu"'],
  ['subtitle="Tổng hợp cơ cấu đơn vị, kho hàng và vị trí lưu trữ phục vụ công tác quản trị nội bộ."', 'subtitle="Theo dõi nhanh chi nhánh, kho hàng và vị trí lưu trữ trong toàn hệ thống."'],
]);

await replaceRequired('npp-core/web/app/organization/organization-workspace.tsx', [
  ['<span>{counts.branches.total} hồ sơ gốc</span>', '<span>{counts.branches.total} chi nhánh</span>'],
  ['<span>{counts.warehouses.total} hồ sơ gốc</span>', '<span>{counts.warehouses.total} kho hàng</span>'],
  ['<span>{counts.locations.total} hồ sơ gốc</span>', '<span>{counts.locations.total} vị trí kho</span>'],
  ['<span className={styles.panelChip}>Dữ liệu hệ thống</span>', '<span className={styles.panelChip}>Cập nhật mới nhất</span>'],
  ["{branch.is_active ? 'Ngừng dùng' : 'Kích hoạt'}", "{branch.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ["{warehouse.is_active ? 'Ngừng dùng' : 'Kích hoạt'}", "{warehouse.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ["{location.is_active ? 'Ngừng dùng' : 'Kích hoạt'}", "{location.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}"],
  ['<th>Cơ cấu trực thuộc</th>', '<th>Đơn vị quản lý</th>'],
  ['Chi nhánh mẹ', 'Chi nhánh quản lý'],
  ['Kho mẹ', 'Kho quản lý'],
  ["{toggleState.nextActive ? 'Bật trở lại' : 'Ngừng hoạt động'}", "{toggleState.nextActive ? 'Đưa vào sử dụng' : 'Ngừng sử dụng'}"],
  ["? `Bạn muốn ${toggleState.nextActive ? 'bật' : 'tắt'} chi nhánh này?`", "? `Bạn muốn ${toggleState.nextActive ? 'đưa vào sử dụng' : 'ngừng sử dụng'} chi nhánh này?`"],
  ["? `Bạn muốn ${toggleState.nextActive ? 'bật' : 'tắt'} kho hàng này?`", "? `Bạn muốn ${toggleState.nextActive ? 'đưa vào sử dụng' : 'ngừng sử dụng'} kho hàng này?`"],
  [": `Bạn muốn ${toggleState.nextActive ? 'bật' : 'tắt'} vị trí kho này?`", ": `Bạn muốn ${toggleState.nextActive ? 'đưa vào sử dụng' : 'ngừng sử dụng'} vị trí kho này?`"],
]);

console.log('Master-data office-language codemod completed');
