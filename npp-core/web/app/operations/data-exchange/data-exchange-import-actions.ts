import {
  type RowMap, type OfficialRows, type Stocktake, type PriceList, type PriceItem, type ImportKind, type Unit, type PendingImport,
  PRODUCT_COLUMNS, PRODUCT_REQUIRED_COLUMNS, PRICING_COLUMNS, STOCKTAKE_COLUMNS,
  labelFor, displayCell, pricingChoice, bool, boolChoice, variantChoice, lotChoice, expiryChoice, normalizeProductChoices,
} from './data-exchange-model';
import { optional, exactQuantity, exportTable, readTable, requireColumns, requestJson, idempotency, trimDecimal } from './data-exchange-file-utils';

type WarehouseOption = { id: string; code: string; name: string };
type ImportActionsContext = Record<string, any> & {
  units: Unit[];
  priceLists: PriceList[];
  warehouses: WarehouseOption[];
  pendingImport: PendingImport | null;
  setPendingImport: (value: PendingImport | null | ((current: PendingImport | null) => PendingImport | null)) => void;
};

export function buildDataExchangeImportActions(ctx: ImportActionsContext) {
  const {
    units, productColumns, pricingColumns, pendingImport, setPendingImport, refreshReferenceData, setMessage, setBusy, fail, begin, priceLists, warehouses, stocktakeWarehouse,
  } = ctx;
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
  function validateProductRows(rows: RowMap[]) {
    const activeUnits = new Set(units.filter((unit) => unit.is_active).map((unit) => unit.code.toUpperCase()));
    for (const [index, row] of rows.entries()) {
      const line = index + 2; const sku = String(row.sku ?? '').trim().toUpperCase();
      if (!String(row.productCode ?? '').trim() || !String(row.productName ?? '').trim()) throw new Error(`Dòng ${line}: cần có Mã sản phẩm và Tên sản phẩm.`);
      for (const field of ['productIsCatalogVisible', 'productIsOrderable', 'productIsActive']) if (!boolChoice(String(row[field] ?? ''))) throw new Error(`Dòng ${line}: chọn Có hoặc Không ở “${labelFor(field)}”.`);
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
  async function submitProductImport(rows: RowMap[], fileName: string) {
    validateProductRows(rows); begin();
    try {
      const result = await requestJson<{ import?: { imported?: number }; onboarding?: { variantsConfigured?: number; policiesConfigured?: number } }>('/api/file-operations/products/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_product_import') },
        body: JSON.stringify({ format: fileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv', rows }),
      });
      await refreshReferenceData(); const info = result.import ?? {}; const onboarding = result.onboarding ?? {};
      setPendingImport(null);
      setMessage(`Đã nhập ${info.imported ?? rows.length} sản phẩm/SKU; đã gắn đơn vị cho ${onboarding.variantsConfigured ?? 0} SKU và thiết lập chính sách kho cho ${onboarding.policiesConfigured ?? 0} SKU.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function loadPricingItems() {
    const rows: Array<{ list: PriceList; item: PriceItem }> = [];
    await Promise.all(priceLists.map(async (list) => { const items = await requestJson<PriceItem[]>(`/api/price-lists/${list.id}/items?limit=2000`); for (const item of items) rows.push({ list, item }); })); return rows;
  }
  async function pricingExport(format: 'xlsx' | 'csv') {
    begin();
    try {
      const result = await requestJson<OfficialRows>('/api/file-operations/pricing/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_pricing_export') }, body: JSON.stringify({ format }) });
      const selected = PRICING_COLUMNS.filter((column) => pricingColumns.has(column) && result.columns.includes(column)); if (!selected.length) throw new Error('Chọn ít nhất một cột để xuất.');
      const rows = result.rows.map((row) => selected.map((column) => displayCell(column, row[column]))); await exportTable('bang-gia-sku.xlsx', 'Giá bán SKU', selected, rows, format); setMessage(`Đã xuất ${rows.length} dòng giá.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function submitPricingImport(rows: RowMap[], fileName: string) {
    if (rows.length > 2000) throw new Error('Mỗi lần chỉ nhập tối đa 2.000 dòng giá.'); begin();
    try {
      const blankSource = rows.filter((row) => !String(row.sourceKey ?? '').trim()); const officialRows = rows.filter((row) => String(row.sourceKey ?? '').trim());
      if (officialRows.length) {
        await requestJson('/api/file-operations/pricing/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_pricing_import') }, body: JSON.stringify({ format: fileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv', rows: officialRows }) });
      }
      if (blankSource.length) {
        const listByCode = new Map<string, PriceList>(priceLists.map((item) => [item.code.toUpperCase(), item] as const)); const existingRows = await loadPricingItems();
        for (const [index, row] of blankSource.entries()) {
          const listCode = String(row.priceListCode ?? '').trim().toUpperCase(); const sku = String(row.sku ?? '').trim().toUpperCase(); const adjustmentType = String(row.adjustmentType ?? '').trim().toUpperCase();
          const list = listByCode.get(listCode); if (!list) throw new Error(`Dòng ${index + 2}: Mã bảng giá ${listCode || 'đang trống'} không tồn tại.`);
          const minQuantity = exactQuantity(String(row.minQuantity ?? '0'), 'minQuantity', 6); const maxQuantity = String(row.maxQuantity ?? '').trim() ? exactQuantity(String(row.maxQuantity), 'maxQuantity', 6) : null;
          const effectiveFrom = optional(row.effectiveFrom); const effectiveTo = optional(row.effectiveTo);
          const matches = existingRows.filter(({ list: currentList, item }) => currentList.id === list.id && item.sku.toUpperCase() === sku && item.adjustment_type === adjustmentType
            && trimDecimal(item.min_quantity) === trimDecimal(minQuantity) && trimDecimal(item.max_quantity ?? '') === trimDecimal(maxQuantity ?? '')
            && String(item.effective_from ?? '') === String(effectiveFrom ?? '') && String(item.effective_to ?? '') === String(effectiveTo ?? ''));
          if (matches.length !== 1) throw new Error(`Không thể xác định duy nhất dòng giá ${listCode}/${sku}. Hãy xuất file mới nhất rồi sửa trên file đó.`);
          const match = matches[0]; const amountMinor = optional(row.amountMinor); const rateBps = optional(row.rateBps);
          await requestJson(`/api/price-lists/${list.id}/items/${match.item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            adjustmentType, amountMinor, rateBps: rateBps ? Number(rateBps) : null, minQuantity, maxQuantity, effectiveFrom, effectiveTo,
            externalRuleCode: optional(row.externalRuleCode), note: optional(row.note), isActive: bool(String(row.isActive ?? ''), 'isActive'), expectedUpdatedAt: match.item.updated_at,
          }) });
        }
      }
      setPendingImport(null); setMessage(`Đã xử lý ${rows.length} dòng giá${blankSource.length ? `; ${blankSource.length} dòng dữ liệu cũ đã được cập nhật có kiểm tra phiên bản.` : ''}`);
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
  async function submitStocktakeImport(rows: RowMap[], fileName: string) {
    if (rows.length > 500) throw new Error('Mỗi đợt kiểm kê tối đa 500 dòng.');
    for (const [index, row] of rows.entries()) exactQuantity(String(row.actualCount ?? ''), `Dòng ${index + 2} actualCount`, 12); begin();
    try {
      const result = await requestJson<{ stocktake: Stocktake }>('/api/file-operations/stocktake/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotency('p10_stocktake_import') }, body: JSON.stringify({ format: fileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv', rows }) });
      setPendingImport(null); setMessage(`Đã tạo phiếu kiểm kê ${result.stocktake.stocktakeNumber} và ghi số đếm. Chưa gửi duyệt, chưa ghi sổ tồn.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }

  async function prepareImport(kind: ImportKind, file: File) {
    begin();
    try {
      let rows = await readTable(file);
      if (kind === 'products') { requireColumns(rows, PRODUCT_REQUIRED_COLUMNS); rows = normalizeProductChoices(rows); }
      if (kind === 'pricing') { requireColumns(rows, ['priceListCode', 'sku', 'adjustmentType', 'sourceKey', 'isActive']); rows = rows.map((row) => ({ ...row, listType: pricingChoice('listType', row.listType ?? ''), adjustmentType: pricingChoice('adjustmentType', row.adjustmentType ?? ''), isActive: boolChoice(row.isActive ?? '') || row.isActive })); }
      if (kind === 'stocktake') requireColumns(rows, STOCKTAKE_COLUMNS);
      setPendingImport({ kind, fileName: file.name, rows }); setMessage(`Đã đọc ${rows.length} dòng từ “${file.name}”. Kiểm tra bảng xem trước rồi bấm Xác nhận nhập.`);
    } catch (cause) { fail(cause); } finally { setBusy(false); }
  }
  async function confirmPendingImport() {
    if (!pendingImport) return;
    if (pendingImport.kind === 'products') return submitProductImport(pendingImport.rows, pendingImport.fileName);
    if (pendingImport.kind === 'pricing') return submitPricingImport(pendingImport.rows, pendingImport.fileName);
    return submitStocktakeImport(pendingImport.rows, pendingImport.fileName);
  }
  function updatePendingRow(index: number, key: string, value: string) {
    setPendingImport((current) => current ? { ...current, rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) } : current);
  }

  return { productTemplate, productExport, pricingExport, stocktakeExport, prepareImport, confirmPendingImport, updatePendingRow };
}
