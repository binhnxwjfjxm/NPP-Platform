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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string; code?: string } };
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload.error?.message || payload.error?.code || 'Yêu cầu không thành công');
  }
  return payload.data as T;
}

function unitToForm(unit: UnitOfMeasure): UnitForm {
  return {
    code: unit.code, name: unit.name, symbol: unit.symbol ?? '', unitKind: unit.unit_kind,
    allowsFractional: unit.allows_fractional, isActive: unit.is_active,
  };
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
    setBusy(true); setMessage(null);
    try {
      const body = { ...form, ...(editing ? { expectedUpdatedAt: editing.updated_at } : {}) };
      const saved = editing
        ? await requestJson<UnitOfMeasure>(`/api/units/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await requestJson<UnitOfMeasure>('/api/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const next = editing ? units.map((item) => item.id === saved.id ? saved : item) : [...units, saved];
      onUnitsChanged(next.sort((a, b) => a.code.localeCompare(b.code)));
      setEditing(saved); setForm(unitToForm(saved)); setShowForm(false);
      setMessage(editing ? 'Đã cập nhật đơn vị tính' : 'Đã tạo đơn vị tính');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể lưu đơn vị tính'); }
    finally { setBusy(false); }
  }

  async function toggle(unit: UnitOfMeasure) {
    setBusy(true); setMessage(null);
    try {
      const saved = await requestJson<UnitOfMeasure>(`/api/units/${unit.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !unit.is_active, expectedUpdatedAt: unit.updated_at }),
      });
      onUnitsChanged(units.map((item) => item.id === saved.id ? saved : item));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể đổi trạng thái'); }
    finally { setBusy(false); }
  }

  return <section data-testid="unit-catalog-panel">
    <div className={styles.sectionHeader}><div><h2>Đơn vị tính</h2><p>Chuẩn hóa tên đơn vị; hệ số quy đổi vẫn gắn riêng từng SKU.</p></div>
      <button type="button" className={styles.primaryButton} onClick={() => { setEditing(null); setForm(EMPTY_UNIT); setShowForm(true); }} data-testid="add-unit-button">Thêm đơn vị</button></div>
    {message ? <div className={styles.notice}>{message}</div> : null}
    {showForm ? <div className={styles.formPanel} data-testid="unit-form"><div className={styles.formGrid}>
      <label>Mã<input value={form.code} disabled={Boolean(editing)} onChange={(e) => setForm({ ...form, code: e.target.value })} data-testid="unit-code-input" /></label>
      <label>Tên<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="unit-name-input" /></label>
      <label>Ký hiệu<input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} /></label>
      <label>Loại<select value={form.unitKind} onChange={(e) => setForm({ ...form, unitKind: e.target.value as UnitForm['unitKind'] })}>
        <option value="COUNT">Đếm</option><option value="PACKAGE">Bao gói</option><option value="WEIGHT">Khối lượng</option><option value="VOLUME">Thể tích</option><option value="OTHER">Khác</option>
      </select></label>
    </div><div className={styles.checks}><label><input type="checkbox" checked={form.allowsFractional} onChange={(e) => setForm({ ...form, allowsFractional: e.target.checked })} /> Cho phép số lẻ</label><label><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Hoạt động</label></div>
      <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void save()} data-testid="save-unit-button">Lưu đơn vị</button></div> : null}
    <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>Mã</th><th>Tên</th><th>Loại</th><th>Số lẻ</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      {units.map((unit) => <tr key={unit.id} data-testid={`unit-row-${unit.code}`}><td><strong>{unit.code}</strong></td><td>{unit.name}</td><td>{UNIT_KIND_LABELS[unit.unit_kind]}</td><td>{unit.allows_fractional ? 'Có' : 'Không'}</td><td>{unit.is_active ? 'Hoạt động' : 'Ngừng'}</td><td className={styles.rowActions}><button type="button" onClick={() => { setEditing(unit); setForm(unitToForm(unit)); setShowForm(true); }}>Sửa</button><button type="button" disabled={busy} onClick={() => void toggle(unit)}>{unit.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button></td></tr>)}
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
      unitId: variant.unit_id ?? '', conversionToBase: variant.conversion_to_base ?? (variant.is_inventory_base ? '1' : ''),
      isPurchasable: variant.is_purchasable,
      netContentValue: variant.net_content_value ?? '',
      netContentUnitCode: (variant.net_content_uom_code as VariantUnitForm['netContentUnitCode']) ?? 'G',
      sourceUnitLabel: variant.source_unit_label ?? '', sourcePackageDescription: variant.source_package_description ?? '',
    });
    setNormalization(null); setMessage(null);
    void requestJson<ProductBarcode[]>(`/api/products/${productId}/variants/${variant.id}/barcodes`).then(setBarcodes).catch(() => setBarcodes([]));
  }, [productId, variant.id]);

  async function saveUnit() {
    setBusy(true); setMessage(null);
    try {
      const saved = await requestJson<ProductVariant>(`/api/products/${productId}/variants/${variant.id}/unit`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          unitId: form.unitId, conversionToBase: variant.is_inventory_base ? '1' : form.conversionToBase,
          isPurchasable: form.isPurchasable,
          netContent: form.netContentValue ? { value: form.netContentValue, unitCode: form.netContentUnitCode } : null,
          sourceUnitLabel: form.sourceUnitLabel || null,
          sourcePackageDescription: form.sourcePackageDescription || null,
          expectedUpdatedAt: variant.updated_at,
        }),
      });
      onVariantUpdated(saved); setMessage('Đã lưu đơn vị và hệ số quy đổi');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể lưu quy đổi'); }
    finally { setBusy(false); }
  }

  async function addBarcode() {
    setBusy(true); setMessage(null);
    try {
      const saved = await requestJson<ProductBarcode>(`/api/products/${productId}/variants/${variant.id}/barcodes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, barcodeType: 'INTERNAL', isPrimary: barcodes.every((item) => !item.is_active) }),
      });
      setBarcodes((current) => [...current, saved]); setBarcode(''); setMessage('Đã thêm mã vạch');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể thêm mã vạch'); }
    finally { setBusy(false); }
  }

  async function toggleBarcode(item: ProductBarcode) {
    setBusy(true); setMessage(null);
    try {
      const saved = await requestJson<ProductBarcode>(`/api/products/${productId}/variants/${variant.id}/barcodes/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !item.is_active, isPrimary: item.is_primary && !item.is_active, expectedUpdatedAt: item.updated_at }),
      });
      setBarcodes((current) => current.map((row) => row.id === saved.id ? saved : row));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể đổi trạng thái mã vạch'); }
    finally { setBusy(false); }
  }

  async function preview() {
    setBusy(true); setMessage(null);
    try {
      const result = await requestJson<QuantityNormalization>(`/api/products/${productId}/variants/${variant.id}/normalize-quantity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity }),
      });
      setNormalization(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể quy đổi'); }
    finally { setBusy(false); }
  }

  return <div className={styles.formPanel} data-testid="variant-unit-panel">
    <div className={styles.sectionHeader}><div><h3>Đơn vị tính &amp; mã vạch — {variant.sku}</h3><p>Số lượng tồn được quy đổi về đơn vị tồn chuẩn; khối lượng bao bì chỉ dùng để mô tả sản phẩm.</p></div></div>
    {message ? <div className={styles.notice}>{message}</div> : null}
    <div className={styles.formGrid}>
      <label>Đơn vị<select value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} data-testid="variant-unit-select"><option value="">Chọn đơn vị</option>{units.filter((u) => u.is_active || u.id === variant.unit_id).map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}</select></label>
      <label>Hệ số về tồn chuẩn<input value={variant.is_inventory_base ? '1' : form.conversionToBase} disabled={variant.is_inventory_base} onChange={(e) => setForm({ ...form, conversionToBase: e.target.value })} data-testid="conversion-input" /></label>
      <label>Khối lượng/dung tích mô tả<input value={form.netContentValue} onChange={(e) => setForm({ ...form, netContentValue: e.target.value })} /></label>
      <label>Đơn vị khối lượng/dung tích<select value={form.netContentUnitCode} onChange={(e) => setForm({ ...form, netContentUnitCode: e.target.value as VariantUnitForm['netContentUnitCode'] })}><option value="G">Gam</option><option value="KG">Kilôgam</option><option value="ML">Mililít</option><option value="L">Lít</option><option value="EA">Cái</option><option value="OTHER">Đơn vị khác</option></select></label>
      <label>Tên đơn vị trên chứng từ nguồn<input value={form.sourceUnitLabel} onChange={(e) => setForm({ ...form, sourceUnitLabel: e.target.value })} /></label>
      <label className={styles.wide}>Quy cách đóng gói trên chứng từ nguồn<input value={form.sourcePackageDescription} onChange={(e) => setForm({ ...form, sourcePackageDescription: e.target.value })} /></label>
    </div><div className={styles.checks}><label><input type="checkbox" checked={form.isPurchasable} onChange={(e) => setForm({ ...form, isPurchasable: e.target.checked })} /> Được phép mua</label></div>
    <button type="button" className={styles.primaryButton} disabled={busy || !form.unitId || !form.conversionToBase} onClick={() => void saveUnit()} data-testid="save-variant-unit-button">Lưu quy đổi</button>

    <div className={styles.inlineTools}><input value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Số lượng cần quy đổi" data-testid="normalize-quantity-input" /><button type="button" disabled={busy || !variant.unit_id} onClick={() => void preview()} data-testid="normalize-quantity-button">Kiểm tra quy đổi</button>{normalization ? <strong data-testid="normalization-result">{normalization.enteredQuantity} {normalization.unitCode} = {normalization.baseQuantity} đơn vị tồn</strong> : null}</div>

    <div className={styles.inlineTools}><input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Mã vạch hoặc mã nội bộ" data-testid="barcode-input" /><button type="button" disabled={busy || !barcode.trim()} onClick={() => void addBarcode()} data-testid="add-barcode-button">Thêm mã vạch</button></div>
    <div className={styles.tableWrapper}><table className={styles.table}><thead><tr><th>Mã vạch</th><th>Loại</th><th>Chính</th><th>Trạng thái</th><th></th></tr></thead><tbody>{barcodes.map((item) => <tr key={item.id} data-testid={`barcode-row-${item.normalized_barcode}`}><td>{item.barcode}</td><td>{BARCODE_TYPE_LABELS[item.barcode_type]}</td><td>{item.is_primary ? 'Có' : 'Không'}</td><td>{item.is_active ? 'Hoạt động' : 'Ngừng'}</td><td><button type="button" onClick={() => void toggleBarcode(item)}>{item.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button></td></tr>)}{barcodes.length === 0 ? <tr><td colSpan={5} className={styles.empty}>Chưa có mã vạch</td></tr> : null}</tbody></table></div>
  </div>;
}
