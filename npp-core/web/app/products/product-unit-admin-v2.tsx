'use client';

import { useEffect, useState } from 'react';
import type {
  ProductBarcode,
  ProductVariant,
  QuantityNormalization,
  UnitForm,
  UnitOfMeasure,
  VariantUnitForm,
} from '../../lib/product-types';
import { formatDecimalForInput, isSafeDecimalIntermediate } from '../../lib/purchase-order-line-entry';
import { normalizeProductStatusError } from '../../lib/product-status-error';
import styles from './products.module.css';

const EMPTY_UNIT: UnitForm = {
  code: '', name: '', symbol: '', unitKind: 'COUNT', allowsFractional: false, isActive: true,
};

const EMPTY_VARIANT_UNIT: VariantUnitForm = {
  unitId: '', conversionToBase: '1', isPurchasable: true,
  netContentValue: '', netContentUnitCode: 'G', sourceUnitLabel: '', sourcePackageDescription: '',
};

const UNIT_KIND_LABELS: Record<UnitOfMeasure['unit_kind'], string> = {
  COUNT: 'Đơn vị đếm', PACKAGE: 'Bao gói', WEIGHT: 'Khối lượng', VOLUME: 'Thể tích', OTHER: 'Loại khác',
};
const BARCODE_TYPE_LABELS: Record<ProductBarcode['barcode_type'], string> = {
  EAN13: 'EAN-13', EAN8: 'EAN-8', UPC_A: 'UPC-A', CODE128: 'Code 128', INTERNAL: 'Mã nội bộ', OTHER: 'Loại khác',
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string; code?: string; details?: unknown };
};

class ProductUiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details: unknown,
  ) {
    super(message);
    this.name = 'ProductUiError';
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new ProductUiError(
      normalizeProductStatusError(payload.error, 'Yêu cầu hàng hóa không thành công.'),
      payload.error?.code || 'PRODUCT_REQUEST_FAILED',
      payload.error?.details ?? {},
    );
  }
  return payload.data as T;
}

function unitToForm(unit: UnitOfMeasure): UnitForm {
  return {
    code: unit.code,
    name: unit.name,
    symbol: unit.symbol ?? '',
    unitKind: unit.unit_kind,
    allowsFractional: unit.allows_fractional,
    isActive: unit.is_active,
  };
}

function cleanDecimal(value: string | null | undefined, fallback = '') {
  return formatDecimalForInput(value ?? fallback) || fallback;
}

export function UnitCatalogPanel({ units, onUnitsChanged }: {
  units: UnitOfMeasure[];
  onUnitsChanged: (units: UnitOfMeasure[]) => void;
}) {
  const [form, setForm] = useState<UnitForm>(EMPTY_UNIT);
  const [editing, setEditing] = useState<UnitOfMeasure | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const body = { ...form, ...(editing ? { expectedUpdatedAt: editing.updated_at } : {}) };
      const saved = editing
        ? await requestJson<UnitOfMeasure>(`/api/units/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await requestJson<UnitOfMeasure>('/api/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const next = editing ? units.map((item) => item.id === saved.id ? saved : item) : [...units, saved];
      onUnitsChanged(next.sort((a, b) => a.code.localeCompare(b.code)));
      setEditing(saved);
      setForm(unitToForm(saved));
      setShowForm(false);
      setMessage(editing ? 'Đã cập nhật đơn vị tính.' : 'Đã tạo đơn vị tính.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu đơn vị tính.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(unit: UnitOfMeasure) {
    if (unit.is_active && !window.confirm(`Ngừng sử dụng đơn vị ${unit.code} — ${unit.name}? Hệ thống sẽ kiểm tra các SKU đang phụ thuộc.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await requestJson<UnitOfMeasure>(`/api/units/${unit.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !unit.is_active, expectedUpdatedAt: unit.updated_at }),
      });
      onUnitsChanged(units.map((item) => item.id === saved.id ? saved : item));
      setMessage(saved.is_active ? 'Đã đưa đơn vị tính vào sử dụng.' : 'Đã ngừng sử dụng đơn vị tính.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể đổi trạng thái đơn vị tính.');
    } finally {
      setBusy(false);
    }
  }

  return <section data-testid="unit-catalog-panel">
    <div className={styles.sectionHeader}><div><h2>Đơn vị tính</h2><p>Chuẩn hóa tên đơn vị; hệ số quy đổi vẫn gắn riêng từng SKU.</p></div>
      <button type="button" className={styles.primaryButton} onClick={() => { setEditing(null); setForm(EMPTY_UNIT); setShowForm(true); setMessage(null); }} data-testid="add-unit-button">Thêm đơn vị</button></div>
    {message ? <div className={styles.notice} role="status">{message}</div> : null}
    {showForm ? <div className={styles.formPanel} data-testid="unit-form"><div className={styles.formGrid}>
      <label>Mã<input value={form.code} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} data-testid="unit-code-input" /></label>
      <label>Tên<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} data-testid="unit-name-input" /></label>
      <label>Ký hiệu<input value={form.symbol} onChange={(event) => setForm({ ...form, symbol: event.target.value })} /></label>
      <label>Loại<select value={form.unitKind} onChange={(event) => setForm({ ...form, unitKind: event.target.value as UnitForm['unitKind'] })}><option value="COUNT">Đếm</option><option value="PACKAGE">Bao gói</option><option value="WEIGHT">Khối lượng</option><option value="VOLUME">Thể tích</option><option value="OTHER">Khác</option></select></label>
    </div><div className={styles.checks}><label><input type="checkbox" checked={form.allowsFractional} onChange={(event) => setForm({ ...form, allowsFractional: event.target.checked })} /> Cho phép số lẻ</label><label><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Hoạt động</label></div>
      <div className={styles.inlineTools}><button type="button" onClick={() => setShowForm(false)} disabled={busy}>Hủy</button><button type="button" className={styles.primaryButton} disabled={busy || !form.code.trim() || !form.name.trim()} onClick={() => void save()} data-testid="save-unit-button">{busy ? 'Đang lưu…' : 'Lưu đơn vị'}</button></div></div> : null}
    <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>Mã</th><th>Tên</th><th>Loại</th><th>Số lẻ</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      {units.map((unit) => <tr key={unit.id} data-testid={`unit-row-${unit.code}`}><td><strong>{unit.code}</strong></td><td>{unit.name}</td><td>{UNIT_KIND_LABELS[unit.unit_kind]}</td><td>{unit.allows_fractional ? 'Có' : 'Không'}</td><td>{unit.is_active ? 'Hoạt động' : 'Ngừng'}</td><td className={styles.rowActions}><button type="button" onClick={() => { setEditing(unit); setForm(unitToForm(unit)); setShowForm(true); setMessage(null); }}>Sửa</button><button type="button" disabled={busy} onClick={() => void toggle(unit)}>{unit.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button></td></tr>)}
      {units.length === 0 ? <tr><td colSpan={6} className={styles.empty}>Chưa có đơn vị tính</td></tr> : null}
    </tbody></table></div>
  </section>;
}

export function VariantUnitPanel({ productId, variant, units, onVariantUpdated }: {
  productId: string;
  variant: ProductVariant;
  units: UnitOfMeasure[];
  onVariantUpdated: (variant: ProductVariant) => void;
}) {
  const [form, setForm] = useState<VariantUnitForm>(EMPTY_VARIANT_UNIT);
  const [barcodes, setBarcodes] = useState<ProductBarcode[]>([]);
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [normalization, setNormalization] = useState<QuantityNormalization | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      unitId: variant.unit_id ?? '',
      conversionToBase: cleanDecimal(variant.conversion_to_base, variant.is_inventory_base ? '1' : ''),
      isPurchasable: variant.is_purchasable,
      netContentValue: cleanDecimal(variant.net_content_value),
      netContentUnitCode: (variant.net_content_uom_code as VariantUnitForm['netContentUnitCode']) ?? 'G',
      sourceUnitLabel: variant.source_unit_label ?? '',
      sourcePackageDescription: variant.source_package_description ?? '',
    });
    setNormalization(null);
    setMessage(null);
    void requestJson<ProductBarcode[]>(`/api/products/${productId}/variants/${variant.id}/barcodes`).then(setBarcodes).catch(() => setBarcodes([]));
  }, [productId, variant.id]);

  async function saveUnit() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await requestJson<ProductVariant>(`/api/products/${productId}/variants/${variant.id}/unit`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          unitId: form.unitId,
          conversionToBase: variant.is_inventory_base ? '1' : form.conversionToBase,
          isPurchasable: form.isPurchasable,
          netContent: form.netContentValue ? { value: form.netContentValue, unitCode: form.netContentUnitCode } : null,
          sourceUnitLabel: form.sourceUnitLabel || null,
          sourcePackageDescription: form.sourcePackageDescription || null,
          expectedUpdatedAt: variant.updated_at,
        }),
      });
      setForm({
        unitId: saved.unit_id ?? '',
        conversionToBase: cleanDecimal(saved.conversion_to_base, saved.is_inventory_base ? '1' : ''),
        isPurchasable: saved.is_purchasable,
        netContentValue: cleanDecimal(saved.net_content_value),
        netContentUnitCode: (saved.net_content_uom_code as VariantUnitForm['netContentUnitCode']) ?? 'G',
        sourceUnitLabel: saved.source_unit_label ?? '',
        sourcePackageDescription: saved.source_package_description ?? '',
      });
      onVariantUpdated(saved);
      setMessage('Đã lưu đơn vị và hệ số quy đổi.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu quy đổi.');
    } finally {
      setBusy(false);
    }
  }

  async function addBarcode() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await requestJson<ProductBarcode>(`/api/products/${productId}/variants/${variant.id}/barcodes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, barcodeType: 'INTERNAL', isPrimary: barcodes.every((item) => !item.is_active) }),
      });
      setBarcodes((current) => [...current, saved]);
      setBarcode('');
      setMessage('Đã thêm mã vạch.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể thêm mã vạch.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleBarcode(item: ProductBarcode) {
    if (item.is_active && !window.confirm(`Ngừng sử dụng mã ${item.barcode}?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await requestJson<ProductBarcode>(`/api/products/${productId}/variants/${variant.id}/barcodes/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !item.is_active, isPrimary: item.is_primary && !item.is_active, expectedUpdatedAt: item.updated_at }),
      });
      setBarcodes((current) => current.map((row) => row.id === saved.id ? saved : row));
      setMessage(saved.is_active ? 'Đã đưa mã vạch vào sử dụng.' : 'Đã ngừng sử dụng mã vạch.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể đổi trạng thái mã vạch.');
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await requestJson<QuantityNormalization>(`/api/products/${productId}/variants/${variant.id}/normalize-quantity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity }),
      });
      setNormalization(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể quy đổi.');
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.formPanel} data-testid="variant-unit-panel">
    <div className={styles.sectionHeader}><div><h3>Đơn vị tính &amp; mã vạch — {variant.sku}</h3><p>Số lượng tồn được quy đổi về đơn vị tồn chuẩn; khối lượng bao bì chỉ dùng để mô tả sản phẩm.</p></div></div>
    {message ? <div className={styles.notice} role="status">{message}</div> : null}
    <div className={styles.formGrid}>
      <label>Đơn vị<select value={form.unitId} onChange={(event) => setForm({ ...form, unitId: event.target.value })} data-testid="variant-unit-select"><option value="">Chọn đơn vị</option>{units.filter((unit) => unit.is_active || unit.id === variant.unit_id).map((unit) => <option key={unit.id} value={unit.id}>{unit.code} — {unit.name}</option>)}</select></label>
      <label>Hệ số về tồn chuẩn<input value={variant.is_inventory_base ? '1' : form.conversionToBase} disabled={variant.is_inventory_base} inputMode="decimal" onChange={(event) => { if (isSafeDecimalIntermediate(event.target.value)) setForm({ ...form, conversionToBase: event.target.value }); }} data-testid="conversion-input" /></label>
      <label>Khối lượng/dung tích mô tả<input value={form.netContentValue} inputMode="decimal" onChange={(event) => { if (isSafeDecimalIntermediate(event.target.value)) setForm({ ...form, netContentValue: event.target.value }); }} /></label>
      <label>Đơn vị khối lượng/dung tích<select value={form.netContentUnitCode} onChange={(event) => setForm({ ...form, netContentUnitCode: event.target.value as VariantUnitForm['netContentUnitCode'] })}><option value="G">Gam</option><option value="KG">Kilôgam</option><option value="ML">Mililít</option><option value="L">Lít</option><option value="EA">Cái</option><option value="OTHER">Đơn vị khác</option></select></label>
      <label>Tên đơn vị trên chứng từ nguồn<input value={form.sourceUnitLabel} onChange={(event) => setForm({ ...form, sourceUnitLabel: event.target.value })} /></label>
      <label className={styles.wide}>Quy cách đóng gói trên chứng từ nguồn<input value={form.sourcePackageDescription} onChange={(event) => setForm({ ...form, sourcePackageDescription: event.target.value })} /></label>
    </div>
    <div className={styles.checks}><label><input type="checkbox" checked={form.isPurchasable} onChange={(event) => setForm({ ...form, isPurchasable: event.target.checked })} /> Được phép mua</label></div>
    <button type="button" className={styles.primaryButton} disabled={busy || !form.unitId || !form.conversionToBase} onClick={() => void saveUnit()} data-testid="save-variant-unit-button">{busy ? 'Đang lưu…' : 'Lưu quy đổi'}</button>

    <div className={styles.inlineTools}><input value={quantity} inputMode="decimal" onChange={(event) => { if (isSafeDecimalIntermediate(event.target.value)) setQuantity(event.target.value); }} aria-label="Số lượng cần quy đổi" data-testid="normalize-quantity-input" /><button type="button" disabled={busy || !variant.unit_id} onClick={() => void preview()} data-testid="normalize-quantity-button">Kiểm tra quy đổi</button>{normalization ? <strong data-testid="normalization-result">{cleanDecimal(normalization.enteredQuantity)} {normalization.unitCode} = {cleanDecimal(normalization.baseQuantity)} đơn vị tồn</strong> : null}</div>

    <div className={styles.inlineTools}><input value={barcode} onChange={(event) => setBarcode(event.target.value)} placeholder="Mã vạch hoặc mã nội bộ" data-testid="barcode-input" /><button type="button" disabled={busy || !barcode.trim()} onClick={() => void addBarcode()} data-testid="add-barcode-button">Thêm mã vạch</button></div>
    <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>Mã vạch</th><th>Loại</th><th>Chính</th><th>Trạng thái</th><th></th></tr></thead><tbody>{barcodes.map((item) => <tr key={item.id} data-testid={`barcode-row-${item.normalized_barcode}`}><td>{item.barcode}</td><td>{BARCODE_TYPE_LABELS[item.barcode_type]}</td><td>{item.is_primary ? 'Có' : 'Không'}</td><td>{item.is_active ? 'Hoạt động' : 'Ngừng'}</td><td><button type="button" disabled={busy} onClick={() => void toggleBarcode(item)}>{item.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button></td></tr>)}{barcodes.length === 0 ? <tr><td colSpan={5} className={styles.empty}>Chưa có mã vạch</td></tr> : null}</tbody></table></div>
  </div>;
}
