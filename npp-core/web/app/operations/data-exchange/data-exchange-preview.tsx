'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './data-exchange.module.css';
import { requestJson } from './data-exchange-file-utils';
import {
  type Tab, type PendingImport, type RowMap, type Unit, type Category, type Brand,
  PRICING_COLUMNS, STOCKTAKE_COLUMNS, labelFor, boolChoice, variantChoice, lotChoice, expiryChoice,
} from './data-exchange-model';

type PreviewContext = {
  pendingImport: PendingImport | null;
  tab: Tab;
  setPendingImport: (value: PendingImport | null | ((current: PendingImport | null) => PendingImport | null)) => void;
  busy: boolean;
  confirmPendingImport: () => Promise<unknown> | unknown;
  units: Unit[];
  updatePendingRow: (index: number, key: string, value: string) => void;
};

type BulkField =
  | 'categoryCode' | 'brandCode' | 'variantKind' | 'unitCode' | 'conversionToBase'
  | 'lotTrackingMode' | 'expiryTrackingMode' | 'locationRequired'
  | 'productIsCatalogVisible' | 'productIsOrderable' | 'productIsActive'
  | 'isSellable' | 'isCatalogVisible' | 'isActive';

const PRODUCT_FIELDS = new Set<BulkField>(['categoryCode', 'brandCode', 'productIsCatalogVisible', 'productIsOrderable', 'productIsActive']);
const INVENTORY_POLICY_FIELDS = new Set<BulkField>(['lotTrackingMode', 'expiryTrackingMode', 'locationRequired']);

function upper(value: string | undefined) { return String(value ?? '').trim().toUpperCase(); }

export function DataExchangeImportPreview({ ctx }: { ctx: PreviewContext }) {
  const { pendingImport, tab, setPendingImport, busy, confirmPendingImport, units, updatePendingRow } = ctx;
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [referenceError, setReferenceError] = useState('');
  const rows: RowMap[] = pendingImport?.rows ?? [];
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkField, setBulkField] = useState<BulkField>('unitCode');
  const [bulkValue, setBulkValue] = useState('');

  useEffect(() => { setSelected(new Set()); setBulkValue(''); }, [pendingImport?.fileName, pendingImport?.kind]);
  useEffect(() => {
    let active = true;
    if (pendingImport?.kind !== 'products') return () => { active = false; };
    setReferenceError('');
    Promise.all([requestJson<Category[]>('/api/product-categories?limit=1000'), requestJson<Brand[]>('/api/product-brands?limit=1000')])
      .then(([nextCategories, nextBrands]) => { if (active) { setCategories(nextCategories); setBrands(nextBrands); } })
      .catch((cause) => { if (active) setReferenceError(cause instanceof Error ? cause.message : 'Không tải được Loại sản phẩm/Nhãn hàng.'); });
    return () => { active = false; };
  }, [pendingImport?.fileName, pendingImport?.kind]);

  const orderedCategories = useMemo(() => [...categories].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [categories]);
  const orderedBrands = useMemo(() => [...brands].sort((a, b) => a.name.localeCompare(b.name, 'vi')), [brands]);
  const activeUnits = useMemo(() => units.filter((unit) => unit.is_active).sort((a, b) => a.name.localeCompare(b.name, 'vi')), [units]);
  const categoryCodes = useMemo(() => new Set(categories.map((item) => upper(item.code))), [categories]);
  const brandCodes = useMemo(() => new Set(brands.map((item) => upper(item.code))), [brands]);

  if (!pendingImport || pendingImport.kind !== tab) return null;

  function toggleRow(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }
  function selectBy(predicate: (row: RowMap) => boolean) {
    setSelected(new Set(rows.map((row, index) => predicate(row) ? index : -1).filter((index) => index >= 0)));
  }
  function expandSameProduct() {
    const codes = new Set([...selected].map((index) => upper(rows[index]?.productCode)).filter(Boolean));
    if (!codes.size) return;
    selectBy((row) => codes.has(upper(row.productCode)));
  }
  function productIndices(index: number) {
    const code = upper(rows[index]?.productCode);
    if (!code) return [index];
    return rows.map((row, rowIndex) => upper(row.productCode) === code ? rowIndex : -1).filter((rowIndex) => rowIndex >= 0);
  }
  function updateMany(indices: number[], key: string, value: string) {
    const chosen = new Set(indices);
    setPendingImport((current) => current ? { ...current, rows: current.rows.map((row, rowIndex) => chosen.has(rowIndex) ? { ...row, [key]: value } : row) } : current);
  }
  function setProductField(index: number, key: string, value: string) { updateMany(productIndices(index), key, value); }
  function referenceOptions(value: string, items: Array<Category | Brand>) {
    const normalized = upper(value); const known = items.some((item) => upper(item.code) === normalized);
    return <><option value="">Không chọn</option>{normalized && !known ? <option value={normalized}>Không tìm thấy — {normalized}</option> : null}{items.map((item) => <option key={item.id} value={upper(item.code)}>{item.name} — {item.code}{item.is_active ? '' : ' (ngưng sử dụng)'}</option>)}</>;
  }
  function booleanOptions() { return <><option value="">Chọn</option><option value="CÓ">Có</option><option value="KHÔNG">Không</option></>; }
  function renderBulkValue() {
    if (bulkField === 'categoryCode') return <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}>{referenceOptions(bulkValue, orderedCategories)}</select>;
    if (bulkField === 'brandCode') return <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}>{referenceOptions(bulkValue, orderedBrands)}</select>;
    if (bulkField === 'unitCode') return <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Chọn đơn vị</option>{activeUnits.map((unit) => <option key={unit.id} value={upper(unit.code)}>{unit.name} — {unit.code}</option>)}</select>;
    if (bulkField === 'variantKind') return <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Chọn loại SKU</option><option value="BASE">Đơn vị lẻ</option><option value="CARTON">Thùng</option><option value="OTHER">Quy cách khác</option></select>;
    if (bulkField === 'conversionToBase') return <input inputMode="decimal" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)} placeholder="VD: 1 hoặc 24" />;
    if (bulkField === 'lotTrackingMode') return <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Chọn</option><option value="KHÔNG">Không</option><option value="CÓ">Có</option></select>;
    if (bulkField === 'expiryTrackingMode') return <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Chọn</option><option value="KHÔNG">Không quản lý</option><option value="TÙY CHỌN">Có thể nhập</option><option value="BẮT BUỘC">Bắt buộc nhập</option></select>;
    if (bulkField === 'locationRequired') return <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}><option value="">Chọn</option><option value="KHÔNG">Không bắt buộc</option><option value="CÓ">Bắt buộc</option></select>;
    return <select value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}>{booleanOptions()}</select>;
  }
  function applyBulk() {
    if (!selected.size || !bulkValue) return;
    let indices = [...selected].sort((a, b) => a - b);
    if (PRODUCT_FIELDS.has(bulkField)) {
      const codes = new Set(indices.map((index) => upper(rows[index]?.productCode)).filter(Boolean));
      indices = rows.map((row, index) => codes.has(upper(row.productCode)) ? index : -1).filter((index) => index >= 0);
    }
    if (INVENTORY_POLICY_FIELDS.has(bulkField)) indices = indices.filter((index) => boolChoice(rows[index]?.isInventoryBase ?? '') === 'CÓ');
    if (!indices.length) return;
    updateMany(indices, bulkField, bulkValue);
  }

  if (pendingImport.kind === 'products') return <div className={styles.previewCard} data-testid="product-import-preview">
    <div className={styles.previewHeader}><div><strong>Xem trước trước khi nhập</strong><span>{pendingImport.fileName} · {rows.length} dòng. Tên sản phẩm/SKU luôn hiển thị; có thể chọn nhiều dòng và áp dụng thiết lập một lần.</span></div><div className={styles.buttonRow}><button className={styles.secondaryButton} type="button" onClick={() => setPendingImport(null)} disabled={busy}>Bỏ file</button><button className={styles.primaryButton} type="button" onClick={() => void confirmPendingImport()} disabled={busy}>Xác nhận nhập {rows.length} dòng</button></div></div>
    {referenceError ? <div className={styles.inlineWarning}>{referenceError}</div> : null}
    <div className={styles.bulkPanel} data-testid="product-import-bulk-editor">
      <div className={styles.bulkSelection}><strong>Thiết lập hàng loạt</strong><span>{selected.size} dòng đã chọn</span><button type="button" onClick={() => selectBy(() => true)}>Tất cả</button><button type="button" onClick={() => selectBy((row) => variantChoice(row.variantKind ?? '') === 'BASE')}>Đơn vị lẻ</button><button type="button" onClick={() => selectBy((row) => variantChoice(row.variantKind ?? '') === 'CARTON')}>Thùng</button><button type="button" onClick={expandSameProduct} disabled={!selected.size}>Mở rộng cùng Mã SP</button><button type="button" onClick={() => setSelected(new Set())} disabled={!selected.size}>Bỏ chọn</button></div>
      <div className={styles.bulkControls}><label>Trường<select value={bulkField} onChange={(event) => { setBulkField(event.target.value as BulkField); setBulkValue(''); }}><option value="categoryCode">Loại sản phẩm</option><option value="brandCode">Nhãn hàng</option><option value="variantKind">Loại SKU</option><option value="unitCode">Đơn vị tính</option><option value="conversionToBase">Hệ số quy đổi</option><option value="lotTrackingMode">Quản lý lô</option><option value="expiryTrackingMode">Hạn sử dụng</option><option value="locationRequired">Vị trí kho</option><option value="productIsCatalogVisible">Hiển thị sản phẩm</option><option value="productIsOrderable">Cho đặt hàng</option><option value="productIsActive">Sản phẩm sử dụng</option><option value="isSellable">Cho bán SKU</option><option value="isCatalogVisible">Hiển thị SKU</option><option value="isActive">SKU sử dụng</option></select></label><label>Giá trị{renderBulkValue()}</label><button className={styles.primaryButton} type="button" onClick={applyBulk} disabled={!selected.size || !bulkValue}>Áp dụng cho {selected.size || 0} dòng</button></div>
      <p>Trường cấp sản phẩm (Loại sản phẩm, Nhãn hàng, hiển thị/đặt hàng/trạng thái sản phẩm) tự đồng bộ cho mọi SKU cùng Mã SP. Chính sách lô/hạn/vị trí chỉ áp dụng cho SKU tồn chuẩn.</p>
    </div>
    <div className={styles.tableWrap}><table className={styles.previewTable}><thead>
      <tr className={styles.groupHeader}><th colSpan={6}>Nhận diện</th><th colSpan={2}>Phân loại sản phẩm</th><th colSpan={4}>Quy cách SKU</th><th colSpan={3}>Kho & truy xuất</th><th colSpan={3}>Sản phẩm</th><th colSpan={3}>SKU</th></tr>
      <tr><th className={styles.stickySelect}><input aria-label="Chọn tất cả dòng" type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={(event) => event.target.checked ? selectBy(() => true) : setSelected(new Set())} /></th><th className={styles.stickyLine}>Dòng</th><th className={styles.stickyProductCode}>Mã SP</th><th className={styles.stickyProductName}>Tên sản phẩm</th><th className={styles.stickySku}>SKU</th><th className={styles.stickySkuName}>Tên SKU / quy cách</th><th>Loại sản phẩm</th><th>Nhãn hàng</th><th>Loại SKU</th><th>Đơn vị tính</th><th>Hệ số quy đổi</th><th>Tồn chuẩn</th><th>Quản lý lô</th><th>Hạn sử dụng</th><th>Vị trí kho</th><th>Hiển thị sản phẩm</th><th>Cho đặt hàng</th><th>Sản phẩm sử dụng</th><th>Cho bán SKU</th><th>Hiển thị SKU</th><th>SKU sử dụng</th></tr>
    </thead><tbody>{rows.map((row, index) => {
      const base = boolChoice(row.isInventoryBase ?? '') === 'CÓ';
      const categoryCode = upper(row.categoryCode); const brandCode = upper(row.brandCode);
      const categoryKnown = !categoryCode || categoryCodes.has(categoryCode); const brandKnown = !brandCode || brandCodes.has(brandCode);
      return <tr key={`${row.productCode}-${row.sku}-${index}`} className={selected.has(index) ? styles.selectedRow : undefined}>
        <td className={styles.stickySelect}><input aria-label={`Chọn dòng ${index + 2}`} type="checkbox" checked={selected.has(index)} onChange={() => toggleRow(index)} /></td><td className={styles.stickyLine}>{index + 2}</td><td className={styles.stickyProductCode}><strong>{row.productCode || '—'}</strong></td><td className={styles.stickyProductName}>{row.productName || '—'}</td><td className={styles.stickySku}><strong>{row.sku || '—'}</strong></td><td className={styles.stickySkuName}>{row.skuName || '—'}</td>
        <td><select className={categoryKnown ? undefined : styles.invalidControl} value={categoryCode} onChange={(event) => setProductField(index, 'categoryCode', event.target.value)}>{referenceOptions(categoryCode, orderedCategories)}</select></td><td><select className={brandKnown ? undefined : styles.invalidControl} value={brandCode} onChange={(event) => setProductField(index, 'brandCode', event.target.value)}>{referenceOptions(brandCode, orderedBrands)}</select></td>
        <td><select value={variantChoice(row.variantKind ?? '')} onChange={(event) => updatePendingRow(index, 'variantKind', event.target.value)}><option value="">Chọn</option><option value="BASE">Đơn vị lẻ</option><option value="CARTON">Thùng</option><option value="OTHER">Quy cách khác</option></select></td><td><select value={upper(row.unitCode)} onChange={(event) => updatePendingRow(index, 'unitCode', event.target.value)}><option value="">Chọn đơn vị</option>{activeUnits.map((unit) => <option key={unit.id} value={upper(unit.code)}>{unit.name} — {unit.code}</option>)}</select></td><td><input inputMode="decimal" value={row.conversionToBase ?? ''} onChange={(event) => updatePendingRow(index, 'conversionToBase', event.target.value)} placeholder={base ? '1' : 'VD: 24'} /></td><td><select value={boolChoice(row.isInventoryBase ?? '')} onChange={(event) => { const value = event.target.value; updatePendingRow(index, 'isInventoryBase', value); if (value === 'KHÔNG') { updatePendingRow(index, 'lotTrackingMode', ''); updatePendingRow(index, 'expiryTrackingMode', ''); updatePendingRow(index, 'locationRequired', ''); } }}>{booleanOptions()}</select></td>
        <td><select disabled={!base} value={base ? lotChoice(row.lotTrackingMode ?? '') : ''} onChange={(event) => updatePendingRow(index, 'lotTrackingMode', event.target.value)}><option value="">Chọn</option><option value="KHÔNG">Không</option><option value="CÓ">Có</option></select></td><td><select disabled={!base} value={base ? expiryChoice(row.expiryTrackingMode ?? '') : ''} onChange={(event) => updatePendingRow(index, 'expiryTrackingMode', event.target.value)}><option value="">Chọn</option><option value="KHÔNG">Không quản lý</option><option value="TÙY CHỌN">Có thể nhập</option><option value="BẮT BUỘC">Bắt buộc nhập</option></select></td><td><select disabled={!base} value={base ? boolChoice(row.locationRequired ?? '') : ''} onChange={(event) => updatePendingRow(index, 'locationRequired', event.target.value)}><option value="">Chọn</option><option value="KHÔNG">Không bắt buộc</option><option value="CÓ">Bắt buộc</option></select></td>
        {(['productIsCatalogVisible', 'productIsOrderable', 'productIsActive'] as const).map((field) => <td key={field}><select value={boolChoice(row[field] ?? '')} onChange={(event) => setProductField(index, field, event.target.value)}>{booleanOptions()}</select></td>)}
        {(['isSellable', 'isCatalogVisible', 'isActive'] as const).map((field) => <td key={field}><select value={boolChoice(row[field] ?? '')} onChange={(event) => updatePendingRow(index, field, event.target.value)}>{booleanOptions()}</select></td>)}
      </tr>;
    })}</tbody></table></div>
    <p className={styles.previewHelp}>Tên và mã luôn đi cùng nhau để không phải nhớ dòng. Nếu file chứa mã loại sản phẩm/nhãn hàng cũ không còn tồn tại, ô sẽ được đánh dấu và phải chọn lại bằng tên trước khi xác nhận. SKU tồn chuẩn thường là đơn vị nhỏ nhất và có hệ số quy đổi = 1. Các lựa chọn Có/Không có thể chỉnh ngay tại đây, không cần nhập TRUE/FALSE trong file.</p>
  </div>;

  const previewColumns = pendingImport.kind === 'pricing' ? PRICING_COLUMNS : STOCKTAKE_COLUMNS;
  return <div className={styles.previewCard}><div className={styles.previewHeader}><div><strong>Xem trước trước khi nhập</strong><span>{pendingImport.fileName} · {rows.length} dòng.</span></div><div className={styles.buttonRow}><button className={styles.secondaryButton} type="button" onClick={() => setPendingImport(null)} disabled={busy}>Bỏ file</button><button className={styles.primaryButton} type="button" onClick={() => void confirmPendingImport()} disabled={busy}>Xác nhận nhập {rows.length} dòng</button></div></div><div className={styles.tableWrap}><table><thead><tr>{previewColumns.map((column) => <th key={column}>{labelFor(column)}</th>)}</tr></thead><tbody>{rows.slice(0, 50).map((row, index) => <tr key={index}>{previewColumns.map((column) => <td key={column}>{row[column] || '—'}</td>)}</tr>)}</tbody></table></div>{rows.length > 50 ? <p className={styles.note}>Đang hiển thị 50 dòng đầu để kiểm tra; khi xác nhận hệ thống vẫn xử lý đủ {rows.length} dòng.</p> : null}</div>;
}
