import {
  type RowMap, type OfficialRows, type Stocktake, type PriceList, type ImportKind, type Unit, type PendingImport, type Category, type Brand,
  PRODUCT_COLUMNS, PRODUCT_REQUIRED_COLUMNS, PRICE_UPDATE_COLUMNS, STOCKTAKE_COLUMNS,
  labelFor, displayCell, boolChoice, variantChoice, lotChoice, expiryChoice, normalizeProductChoices,
} from './data-exchange-model';
import { exactQuantity, exportTable, readTable, requireColumns, requestJson, idempotency, trimDecimal } from './data-exchange-file-utils';

type WarehouseOption = { id: string; code: string; name: string };
type ImportActionsContext = Record<string, any> & {
  units: Unit[];
  priceLists: PriceList[];
  warehouses: WarehouseOption[];
  pendingImport: PendingImport | null;
  importOperationKeyRef: { current: string | null };
  setPendingImport: (value: PendingImport | null | ((current: PendingImport | null) => PendingImport | null)) => void;
};

export function buildDataExchangeImportActions(ctx: ImportActionsContext) {
  const {
    units, productColumns, pendingImport, importOperationKeyRef, setPendingImport, refreshReferenceData, setMessage, setBusy, fail, begin,
    priceLists, pricingPriceListId, warehouses, stocktakeWarehouse,
  } = ctx;
  function importOperation(kind: ImportKind) {
    if (kind === 'pricing') return 'price-file';
    if (kind === 'products') return 'product-file';
    return 'stocktake-file';
  }
  function currentImportKey(kind: ImportKind) {
    const key = importOperationKeyRef.current ?? idempotency(importOperation(kind));
    importOperationKeyRef.current = key;
    return key;
  }
  function completeImport() {
    importOperationKeyRef.current = null;
    setPendingImport(null);
  }
  async function productTemplate(format: 'xlsx' | 'csv') {
    begin();
    try { await exportTable('mau-san-pham-sku.xlsx', 'Sản phẩm SKU', [...PRODUCT_COLUMNS], [], format); setMessage(`Đã tải mẫu ${format.toUpperCase()} cho sản phẩm/SKU.`); }
    catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function productExport(format: 'xlsx' | 'csv') {
    begin();
    try {
      const result = await requestJson<OfficialRows>('/api/file-operations/products/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_product_export') }, body: JSON.stringify({ format }) });
      const selected = PRODUCT_COLUMNS.filter((column) => productColumns.has(column) && result.columns.includes(column)); if (!selected.length) throw new Error('Chọn ít nhất một cột để xuất.');
      const rows = result.rows.map((row) => selected.map((column) => displayCell(column, row[column]))); await exportTable('san-pham-sku.xlsx', 'Sản phẩm SKU', selected, rows, format);
      setMessage(`Đã xuất ${rows.length} dòng SKU.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  function validateProductRows(rows: RowMap[], categories: Category[], brands: Brand[]) {
    const activeUnits = new Set(units.filter((unit) => unit.is_active).map((unit) => unit.code.toUpperCase()));
    const categoryCodes = new Set(categories.map((item) => item.code.toUpperCase()));
    const brandCodes = new Set(brands.map((item) => item.code.toUpperCase()));
    const productIdentity = new Map<string, string>();
    for (const [index, row] of rows.entries()) {
      const line = index + 2; const productCode = String(row.productCode ?? '').trim().toUpperCase(); const sku = String(row.sku ?? '').trim().toUpperCase();
      if (!productCode || !String(row.productName ?? '').trim()) throw new Error(`Dòng ${line}: cần có Mã sản phẩm và Tên sản phẩm.`);
      const categoryCode = String(row.categoryCode ?? '').trim().toUpperCase(); const brandCode = String(row.brandCode ?? '').trim().toUpperCase();
      if (categoryCode && !categoryCodes.has(categoryCode)) throw new Error(`Dòng ${line} · Mã SP ${productCode}: Loại sản phẩm “${categoryCode}” không tồn tại. Chọn lại Loại sản phẩm bằng tên trong bảng xem trước.`);
      if (brandCode && !brandCodes.has(brandCode)) throw new Error(`Dòng ${line} · Mã SP ${productCode}: Nhãn hàng “${brandCode}” không tồn tại. Chọn lại Nhãn hàng bằng tên trong bảng xem trước.`);
      for (const field of ['productIsCatalogVisible', 'productIsOrderable', 'productIsActive']) if (!boolChoice(String(row[field] ?? ''))) throw new Error(`Dòng ${line}: chọn Có hoặc Không ở “${labelFor(field)}”.`);
      const identity = JSON.stringify([String(row.productName ?? '').trim(), String(row.catalogName ?? '').trim(), categoryCode, brandCode, String(row.description ?? '').trim(), String(row.notes ?? '').trim(), boolChoice(String(row.productIsCatalogVisible ?? '')), boolChoice(String(row.productIsOrderable ?? '')), boolChoice(String(row.productIsActive ?? ''))]);
      const existingIdentity = productIdentity.get(productCode);
      if (existingIdentity && existingIdentity !== identity) throw new Error(`Mã SP ${productCode}: thông tin cấp sản phẩm đang không đồng nhất giữa các dòng SKU. Hãy chỉnh cùng một Loại sản phẩm, Nhãn hàng và trạng thái cho toàn bộ SKU của mã này.`);
      productIdentity.set(productCode, identity);
      if (!sku) continue;
      if (!String(row.skuName ?? '').trim()) throw new Error(`Dòng ${line} · SKU ${sku}: cần có Tên SKU / quy cách.`);
      if (!['BASE', 'CARTON', 'OTHER'].includes(variantChoice(String(row.variantKind ?? '')))) throw new Error(`Dòng ${line} · SKU ${sku}: chọn Loại SKU.`);
      for (const field of ['isSellable', 'isCatalogVisible', 'isActive']) if (!boolChoice(String(row[field] ?? ''))) throw new Error(`Dòng ${line} · SKU ${sku}: chọn Có hoặc Không ở “${labelFor(field)}”.`);
      const unitCode = String(row.unitCode ?? '').trim().toUpperCase();
      if (!unitCode) throw new Error(`Dòng ${line} · SKU ${sku}: chưa chọn Đơn vị tính. Chọn đơn vị trong bảng xem trước.`);
      if (!activeUnits.has(unitCode)) throw new Error(`Dòng ${line} · SKU ${sku}: Đơn vị tính “${unitCode}” chưa có hoặc đã ngừng sử dụng. Hãy chọn đơn vị khác hoặc tạo đơn vị trước.`);
      const conversion = String(row.conversionToBase ?? '').trim();
      if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(conversion) || /^0(?:\.0+)?$/.test(conversion)) throw new Error(`Dòng ${line} · SKU ${sku}: Hệ số quy đổi phải lớn hơn 0.`);
      const inventoryBase = boolChoice(String(row.isInventoryBase ?? ''));
      if (!inventoryBase) throw new Error(`Dòng ${line} · SKU ${sku}: chọn Có hoặc Không ở “SKU dùng làm đơn vị tồn chuẩn”.`);
      if (inventoryBase === 'CÓ') {
        if (Number(conversion) !== 1) throw new Error(`Dòng ${line} · SKU ${sku}: SKU dùng làm đơn vị tồn chuẩn phải có Hệ số quy đổi = 1.`);
        const lot = lotChoice(String(row.lotTrackingMode ?? '')); const expiry = expiryChoice(String(row.expiryTrackingMode ?? '')); const location = boolChoice(String(row.locationRequired ?? ''));
        if (!lot) throw new Error(`Dòng ${line} · SKU ${sku}: chọn Có hoặc Không ở “Quản lý theo lô”.`);
        if (!expiry) throw new Error(`Dòng ${line} · SKU ${sku}: chọn cách “Quản lý hạn sử dụng”.`);
        if (!location) throw new Error(`Dòng ${line} · SKU ${sku}: chọn Có hoặc Không ở “Bắt buộc chọn vị trí kho”.`);
        if (expiry !== 'KHÔNG' && lot !== 'CÓ') throw new Error(`Dòng ${line} · SKU ${sku}: muốn quản lý hạn sử dụng thì phải bật Quản lý theo lô.`);
      }
    }
  }
  async function submitProductImport(rows: RowMap[], fileName: string, operationKey: string) {
    begin();
    try {
      const [categories, brands] = await Promise.all([requestJson<Category[]>('/api/product-categories?limit=1000'), requestJson<Brand[]>('/api/product-brands?limit=1000')]);
      validateProductRows(rows, categories, brands);
      const result = await requestJson<{ import?: { imported?: number }; onboarding?: { variantsConfigured?: number; policiesConfigured?: number } }>('/api/file-operations/products/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey },
        body: JSON.stringify({ format: fileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv', rows }),
      });
      await refreshReferenceData(); const info = result.import ?? {}; const onboarding = result.onboarding ?? {};
      completeImport();
      setMessage(`Đã nhập ${info.imported ?? rows.length} sản phẩm/SKU; đã gắn đơn vị cho ${onboarding.variantsConfigured ?? 0} SKU và thiết lập chính sách kho cho ${onboarding.policiesConfigured ?? 0} SKU.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  function selectedPriceList() {
    const list = priceLists.find((item) => item.id === pricingPriceListId) ?? null;
    if (!list) throw new Error('Chọn bảng giá/chương trình cần cập nhật.');
    if (!list.is_active) throw new Error('Bảng giá/chương trình đã ngừng sử dụng.');
    return list;
  }
  async function pricingTemplate(format: 'xlsx' | 'csv') {
    begin();
    try {
      await exportTable('mau-cap-nhat-gia.xlsx', 'Mẫu cập nhật giá', [...PRICE_UPDATE_COLUMNS], [], format);
      setMessage(`Đã tải mẫu ${format.toUpperCase()} gồm đúng 2 cột: SKU và Giá bán (VND).`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function pricingExport(format: 'xlsx' | 'csv') {
    begin();
    try {
      const list = selectedPriceList();
      const result = await requestJson<OfficialRows>('/api/file-operations/pricing/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_pricing_export') }, body: JSON.stringify({ format }) });
      const sourceRows = result.rows.filter((row) => String(row.priceListCode ?? '').toUpperCase() === list.code.toUpperCase()
        && String(row.adjustmentType ?? '').toUpperCase() === 'FIXED_PRICE'
        && trimDecimal(String(row.minQuantity ?? '0')) === '0'
        && !String(row.maxQuantity ?? '').trim() && !String(row.effectiveFrom ?? '').trim() && !String(row.effectiveTo ?? '').trim()
        && (row.isActive === true || String(row.isActive ?? '').toLowerCase() === 'true'));
      const rows = sourceRows.map((row) => [String(row.sku ?? ''), String(row.amountMinor ?? '')]);
      await exportTable(`cap-nhat-gia-${list.code}.xlsx`, 'Cập nhật giá', [...PRICE_UPDATE_COLUMNS], rows, format);
      setMessage(`Đã xuất ${rows.length} SKU đang có giá trong ${list.code}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function submitPricingImport(rows: RowMap[], operationKey: string) {
    begin();
    try {
      if (rows.length > 2000) throw new Error('Mỗi lần chỉ nhập tối đa 2.000 dòng giá.');
      const list = selectedPriceList();
      const seen = new Set<string>();
      const items = rows.map((row, index) => {
        const sku = String(row.sku ?? '').trim().toUpperCase();
        const amountMinor = String(row.amountMinor ?? '').trim();
        if (!sku) throw new Error(`Dòng ${index + 2}: SKU đang trống.`);
        if (seen.has(sku)) throw new Error(`Dòng ${index + 2}: SKU ${sku} bị lặp trong file.`);
        seen.add(sku);
        if (!/^(?:0|[1-9]\d{0,18})$/.test(amountMinor)) throw new Error(`Dòng ${index + 2} · SKU ${sku}: Giá bán phải là số nguyên không âm.`);
        return { priceListCode: list.code, sku, adjustmentType: 'FIXED_PRICE', amountMinor, minQuantity: '0', maxQuantity: null, effectiveFrom: null, effectiveTo: null, sourceKind: 'IMPORT', note: null, isActive: true };
      });
      const sourceBatchId = operationKey;
      const result = await requestJson<{ itemsCreated?: number; itemsUpdated?: number; totalItems?: number }>('/api/pricing/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey },
        body: JSON.stringify({ matchBySku: true, sourceBatchId, items }),
      });
      completeImport();
      setMessage(`Đã cập nhật ${result.itemsUpdated ?? 0} SKU, tạo mới ${result.itemsCreated ?? 0} dòng giá theo SKU trong ${list.code}.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function stocktakeExport(format: 'xlsx' | 'csv') {
    begin();
    try {
      const warehouse = warehouses.find((item) => item.id === stocktakeWarehouse); if (!warehouse) throw new Error('Chọn kho trước khi tải file kiểm kê.');
      const result = await requestJson<OfficialRows>('/api/file-operations/stocktake/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_stocktake_export') }, body: JSON.stringify({ warehouseId: warehouse.id, format }) });
      const selected = STOCKTAKE_COLUMNS.filter((column) => result.columns.includes(column)); const rows = result.rows.map((row) => selected.map((column) => String(row[column] ?? '')));
      await exportTable(`kiem-ke-${warehouse.code}.xlsx`, 'Kiểm kê thực tế', selected, rows, format); setMessage(`Đã tạo file kiểm kê gồm ${rows.length} dòng; file không hiển thị số tồn hệ thống để bảo đảm kiểm kê độc lập.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function submitStocktakeImport(rows: RowMap[], fileName: string, operationKey: string) {
    if (rows.length > 500) throw new Error('Mỗi đợt kiểm kê tối đa 500 dòng.');
    for (const [index, row] of rows.entries()) exactQuantity(String(row.actualCount ?? ''), `Dòng ${index + 2} actualCount`, 12); begin();
    try {
      const result = await requestJson<{ stocktake: Stocktake }>('/api/file-operations/stocktake/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationKey }, body: JSON.stringify({ format: fileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv', rows }) });
      completeImport(); setMessage(`Đã tạo phiếu kiểm kê ${result.stocktake.stocktakeNumber} và ghi số đếm. Chưa gửi duyệt, chưa ghi sổ tồn.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function prepareImport(kind: ImportKind, file: File) {
    begin();
    importOperationKeyRef.current = null;
    setPendingImport(null);
    try {
      const requiredColumns = kind === 'products' ? PRODUCT_REQUIRED_COLUMNS : kind === 'pricing' ? PRICE_UPDATE_COLUMNS : STOCKTAKE_COLUMNS;
      let rows = await readTable(file, requiredColumns);
      if (kind === 'products') { requireColumns(rows, PRODUCT_REQUIRED_COLUMNS); rows = normalizeProductChoices(rows); }
      if (kind === 'pricing') requireColumns(rows, PRICE_UPDATE_COLUMNS);
      if (kind === 'stocktake') requireColumns(rows, STOCKTAKE_COLUMNS);
      importOperationKeyRef.current = idempotency(importOperation(kind));
      setPendingImport({ kind, fileName: file.name, rows }); setMessage(`Đã đọc ${rows.length} dòng từ “${file.name}”. Kiểm tra bảng xem trước rồi bấm Xác nhận nhập.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function confirmPendingImport() {
    if (!pendingImport) return;
    const operationKey = currentImportKey(pendingImport.kind);
    if (pendingImport.kind === 'products') return submitProductImport(pendingImport.rows, pendingImport.fileName, operationKey);
    if (pendingImport.kind === 'pricing') return submitPricingImport(pendingImport.rows, operationKey);
    return submitStocktakeImport(pendingImport.rows, pendingImport.fileName, operationKey);
  }
  function updatePendingRow(index: number, key: string, value: string) {
    if (pendingImport) importOperationKeyRef.current = idempotency(importOperation(pendingImport.kind));
    setPendingImport((current) => current ? { ...current, rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) } : current);
  }
  return { productTemplate, productExport, pricingTemplate, pricingExport, stocktakeExport, prepareImport, confirmPendingImport, updatePendingRow };
}
