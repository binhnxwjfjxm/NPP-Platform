'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/app-shell';
import Modal from '../components/modal';
import type {
  DocumentNumberAllocation,
  DocumentNumberHistory,
  DocumentNumberSeries,
  DocumentNumberSeriesForm,
} from '../../lib/document-numbering-types';
import styles from './document-numbering.module.css';

const DOCUMENT_TYPES = [
  { value: 'SALES_ORDER', label: 'Đơn bán hàng' },
  { value: 'PURCHASE_ORDER', label: 'Đơn mua hàng' },
  { value: 'GOODS_RECEIPT', label: 'Phiếu nhập kho' },
  { value: 'GOODS_ISSUE', label: 'Phiếu xuất kho' },
  { value: 'DELIVERY_ORDER', label: 'Phiếu giao hàng' },
  { value: 'INVENTORY_TRANSFER', label: 'Phiếu chuyển kho' },
  { value: 'INVENTORY_ADJUSTMENT', label: 'Phiếu điều chỉnh tồn kho' },
  { value: 'CUSTOMER_RETURN', label: 'Phiếu nhận hàng trả lại' },
  { value: 'SUPPLIER_RETURN', label: 'Phiếu trả hàng nhà cung cấp' },
  { value: 'CUSTOMER_PAYMENT', label: 'Phiếu thu' },
  { value: 'SUPPLIER_PAYMENT', label: 'Phiếu chi' },
  { value: 'CUSTOMER_REFUND', label: 'Phiếu hoàn tiền khách hàng' },
  { value: 'INVOICE', label: 'Hóa đơn' },
] as const;

const RESET_POLICY_LABELS: Record<DocumentNumberSeriesForm['resetPolicy'], string> = {
  NONE: 'Không đánh lại số',
  YEARLY: 'Đánh lại theo năm',
  MONTHLY: 'Đánh lại theo tháng',
};

const EMPTY_FORM: DocumentNumberSeriesForm = {
  documentType: 'SALES_ORDER',
  name: '',
  prefix: 'SO-',
  numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}',
  resetPolicy: 'MONTHLY',
};

function todayInVietnam() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function documentTypeLabel(value: string) {
  return DOCUMENT_TYPES.find((item) => item.value === value)?.label || 'Loại chứng từ khác';
}

function seriesToForm(series: DocumentNumberSeries): DocumentNumberSeriesForm {
  return {
    documentType: series.document_type,
    name: series.name,
    prefix: series.prefix,
    numberTemplate: series.number_template,
    resetPolicy: series.reset_policy,
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload.error?.message || payload.error?.code || 'Yêu cầu không thành công');
  }
  return payload.data as T;
}

function requestKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export default function DocumentNumberingWorkspace() {
  const [series, setSeries] = useState<DocumentNumberSeries[]>([]);
  const [selected, setSelected] = useState<DocumentNumberSeries | null>(null);
  const [history, setHistory] = useState<DocumentNumberHistory>({ allocations: [], counters: [] });
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [form, setForm] = useState<DocumentNumberSeriesForm>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DocumentNumberSeries | null>(null);
  const [documentDate, setDocumentDate] = useState(todayInVietnam());
  const [allocationKey, setAllocationKey] = useState(() => requestKey('reference-number'));
  const [lastAllocation, setLastAllocation] = useState<DocumentNumberAllocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visibleSeries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return series.filter((item) => {
      if (activeFilter === 'active' && !item.is_active) return false;
      if (activeFilter === 'inactive' && item.is_active) return false;
      if (!query) return true;
      return [
        item.document_type,
        documentTypeLabel(item.document_type),
        item.name,
        item.prefix,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [series, search, activeFilter]);

  async function loadSeries(selectId?: string) {
    const next = await requestJson<DocumentNumberSeries[]>('/api/document-number-series?limit=1000');
    setSeries(next);
    if (selectId) {
      const found = next.find((item) => item.id === selectId) ?? null;
      setSelected(found);
      return found;
    }
    return null;
  }

  async function loadHistory(seriesId: string) {
    const next = await requestJson<DocumentNumberHistory>(`/api/document-number-series/${seriesId}/allocations?limit=200`);
    setHistory(next);
  }

  useEffect(() => {
    setBusy(true);
    void loadSeries()
      .catch((value) => setError(value instanceof Error ? value.message : 'Không thể tải quy tắc đánh số'))
      .finally(() => setBusy(false));
  }, []);

  async function selectSeries(item: DocumentNumberSeries) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setLastAllocation(null);
    try {
      setSelected(item);
      await loadHistory(item.id);
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Không thể tải lịch sử cấp số');
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
    setNotice(null);
  }

  function openEdit(item: DocumentNumberSeries) {
    setEditing(item);
    setForm(seriesToForm(item));
    setShowForm(true);
    setError(null);
    setNotice(null);
  }

  function closeForm() {
    if (busy) return;
    setShowForm(false);
    setError(null);
  }

  async function saveSeries() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        documentType: form.documentType,
        name: form.name,
        prefix: form.prefix,
        numberTemplate: form.numberTemplate,
        resetPolicy: form.resetPolicy,
        ...(editing ? { expectedUpdatedAt: editing.updated_at } : {}),
      };
      const saved = editing
        ? await requestJson<DocumentNumberSeries>(`/api/document-number-series/${editing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await requestJson<DocumentNumberSeries>('/api/document-number-series', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey('number-rule') },
            body: JSON.stringify(body),
          });
      setShowForm(false);
      setEditing(saved);
      const refreshed = await loadSeries(saved.id);
      if (refreshed) await loadHistory(refreshed.id);
      setNotice(editing ? 'Đã cập nhật quy tắc đánh số' : 'Đã tạo quy tắc đánh số');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Không thể lưu quy tắc đánh số');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(item: DocumentNumberSeries) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await requestJson<DocumentNumberSeries>(`/api/document-number-series/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !item.is_active, expectedUpdatedAt: item.updated_at }),
      });
      const refreshed = await loadSeries(saved.id);
      if (refreshed && selected?.id === refreshed.id) await loadHistory(refreshed.id);
      setNotice(saved.is_active ? 'Đã đưa quy tắc vào sử dụng' : 'Đã ngừng sử dụng quy tắc');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Không thể thay đổi trạng thái quy tắc');
    } finally {
      setBusy(false);
    }
  }

  async function allocateReferenceNumber() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setLastAllocation(null);
    try {
      const saved = await requestJson<DocumentNumberAllocation>(`/api/document-number-series/${selected.id}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': allocationKey },
        body: JSON.stringify({ documentDate, metadata: { purpose: 'manual_reference_allocation' } }),
      });
      setLastAllocation(saved);
      await loadHistory(selected.id);
      const refreshed = await loadSeries(selected.id);
      if (refreshed) setSelected(refreshed);
      setNotice(saved.replayed
        ? 'Yêu cầu này đã được xử lý trước đó; hệ thống trả lại đúng số đã cấp'
        : 'Đã cấp số tham chiếu và lưu vào lịch sử');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Không thể cấp số tham chiếu');
    } finally {
      setBusy(false);
    }
  }

  const currentDocumentTypeKnown = DOCUMENT_TYPES.some((item) => item.value === form.documentType);

  return (
    <AppShell
      title="Số chứng từ"
      subtitle="Thiết lập cách đánh số tự động theo từng loại chứng từ"
      kicker="Quản lý chứng từ"
    >
      <main className={styles.workspace} data-testid="document-numbering-page">
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Thiết lập quy tắc</span>
            <h2>Quy tắc đánh số dùng chung</h2>
            <p>Mỗi loại chứng từ chỉ có một quy tắc đang sử dụng. Mã kỹ thuật do hệ thống quản lý tự động.</p>
          </div>
          <button type="button" className={styles.primaryButton} onClick={openCreate} data-testid="add-number-series-button">
            Thêm quy tắc
          </button>
        </section>

        {error && !showForm ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
        {notice ? <div className={styles.noticeBanner} data-testid="numbering-notice">{notice}</div> : null}

        <section className={styles.panel}>
          <div className={styles.filters}>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm loại chứng từ hoặc tên quy tắc"
              data-testid="number-series-search"
            />
            <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang sử dụng</option>
              <option value="inactive">Đã ngừng sử dụng</option>
            </select>
            <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void loadSeries(selected?.id)}>
              Cập nhật danh sách
            </button>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr><th>Quy tắc</th><th>Cấu trúc số</th><th>Chu kỳ</th><th>Số đã cấp</th><th>Trạng thái</th><th>Thao tác</th></tr>
              </thead>
              <tbody>
                {visibleSeries.map((item) => (
                  <tr key={item.id} data-testid={`number-series-row-${item.id}`} className={selected?.id === item.id ? styles.selectedRow : undefined}>
                    <td><strong>{item.name}</strong><small>{documentTypeLabel(item.document_type)}</small></td>
                    <td><code>{item.number_template}</code>{item.format_locked ? <span className={styles.locked}>Đã cố định</span> : null}</td>
                    <td>{RESET_POLICY_LABELS[item.reset_policy]}</td>
                    <td>{item.allocation_count}</td>
                    <td>{item.is_active ? 'Đang sử dụng' : 'Đã ngừng'}</td>
                    <td className={styles.actions}>
                      <button type="button" onClick={() => void selectSeries(item)} data-testid={`select-number-series-${item.id}`}>Chi tiết</button>
                      <button type="button" onClick={() => openEdit(item)}>Sửa</button>
                      <button type="button" disabled={busy} onClick={() => void toggleActive(item)}>{item.is_active ? 'Ngừng sử dụng' : 'Đưa vào sử dụng'}</button>
                    </td>
                  </tr>
                ))}
                {visibleSeries.length === 0 ? <tr><td colSpan={6} className={styles.empty}>Chưa có quy tắc phù hợp</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        {selected ? (
          <section className={styles.detailGrid} data-testid="number-series-detail">
            <div className={styles.panel}>
              <div className={styles.sectionHeader}>
                <div><span className={styles.eyebrow}>Cấp số tham chiếu</span><h3>{selected.name}</h3><small>{documentTypeLabel(selected.document_type)}</small></div>
                <span className={selected.is_active ? styles.activeBadge : styles.inactiveBadge}>{selected.is_active ? 'Đang sử dụng' : 'Đã ngừng'}</span>
              </div>
              <p className={styles.warning}>
                Thao tác này cấp một số thật để kiểm tra quy tắc trước khi áp dụng. Số đã cấp được lưu trong lịch sử nhưng không tạo đơn hàng, phiếu kho, hóa đơn hoặc bút toán.
              </p>
              <div className={styles.formGrid}>
                <label>Ngày chứng từ<input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} data-testid="allocation-date-input" /></label>
                <label>Mã yêu cầu<input value={allocationKey} onChange={(event) => setAllocationKey(event.target.value)} data-testid="allocation-key-input" /></label>
              </div>
              <div className={styles.actionsBar}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={busy || !selected.is_active || !documentDate || !allocationKey.trim()}
                  onClick={() => void allocateReferenceNumber()}
                  data-testid="allocate-test-number-button"
                >
                  Cấp số tham chiếu
                </button>
                <button type="button" className={styles.secondaryButton} onClick={() => setAllocationKey(requestKey('reference-number'))}>
                  Tạo mã yêu cầu mới
                </button>
              </div>
              {lastAllocation ? (
                <div className={styles.result} data-testid="allocation-result">
                  <span>{lastAllocation.replayed ? 'Số đã cấp trước đó' : 'Số vừa cấp'}</span>
                  <strong>{lastAllocation.document_number}</strong>
                  <small>Kỳ {lastAllocation.period_key} · số thứ tự {lastAllocation.counter_value}</small>
                </div>
              ) : null}
            </div>

            <div className={styles.panel}>
              <div className={styles.sectionHeader}><div><span className={styles.eyebrow}>Tiến độ đánh số</span><h3>Số tiếp theo theo từng kỳ</h3></div></div>
              <div className={styles.counterList}>
                {history.counters.map((counter) => (
                  <div key={counter.period_key} className={styles.counterCard}>
                    <strong>{counter.period_key}</strong><span>Số tiếp theo</span><b>{counter.next_counter}</b>
                  </div>
                ))}
                {history.counters.length === 0 ? <p>Chưa phát sinh số trong kỳ nào.</p> : null}
              </div>
            </div>

            <div className={`${styles.panel} ${styles.fullWidth}`}>
              <div className={styles.sectionHeader}>
                <div><span className={styles.eyebrow}>Lịch sử cấp số</span><h3>Các số đã cấp</h3></div>
                <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void loadHistory(selected.id)}>Cập nhật lịch sử</button>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead><tr><th>Số chứng từ</th><th>Ngày chứng từ</th><th>Kỳ</th><th>Số thứ tự</th><th>Thời điểm cấp</th></tr></thead>
                  <tbody>
                    {history.allocations.map((item) => (
                      <tr key={item.id} data-testid={`allocation-row-${item.document_number}`}>
                        <td><strong>{item.document_number}</strong></td>
                        <td>{item.document_date}</td>
                        <td>{item.period_key}</td>
                        <td>{item.counter_value}</td>
                        <td>{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(item.allocated_at))}</td>
                      </tr>
                    ))}
                    {history.allocations.length === 0 ? <tr><td colSpan={5} className={styles.empty}>Chưa có số nào được cấp</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        <Modal
          open={showForm}
          title={editing ? `Sửa ${editing.name}` : 'Tạo quy tắc đánh số'}
          description="Chọn loại chứng từ và cấu hình cách hiển thị số. Mã kỹ thuật được hệ thống tự quản lý."
          onClose={closeForm}
          testId="number-series-modal"
          size="large"
          footer={(
            <>
              <button type="button" className={styles.secondaryButton} disabled={busy} onClick={closeForm}>Hủy</button>
              <button type="button" className={styles.primaryButton} disabled={busy || !form.name.trim()} onClick={() => void saveSeries()} data-testid="save-number-series-button">Lưu quy tắc</button>
            </>
          )}
        >
          {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
          {editing?.format_locked ? <p className={styles.warning}>Cấu trúc số đã được cố định vì quy tắc này đã có lịch sử cấp số.</p> : null}
          <div className={styles.formGrid} data-testid="number-series-form">
            <label>
              Loại chứng từ
              <select value={form.documentType} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, documentType: event.target.value })} data-testid="document-type-input">
                {!currentDocumentTypeKnown ? <option value={form.documentType}>{documentTypeLabel(form.documentType)}</option> : null}
                {DOCUMENT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>Tên quy tắc<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} data-testid="number-series-name-input" /></label>
            <label>Ký hiệu đầu số<input value={form.prefix} disabled={Boolean(editing?.format_locked)} onChange={(event) => setForm({ ...form, prefix: event.target.value.toUpperCase() })} data-testid="number-prefix-input" /></label>
            <label className={styles.wide}>
              Cấu trúc số
              <input value={form.numberTemplate} disabled={Boolean(editing?.format_locked)} onChange={(event) => setForm({ ...form, numberTemplate: event.target.value.toUpperCase() })} data-testid="number-template-input" />
              <small>Thành phần có thể dùng: {'{PREFIX}'} {'{YYYY}'} {'{YY}'} {'{MM}'} {'{SEQ}'}</small>
            </label>
            <label>
              Chu kỳ đánh lại số
              <select value={form.resetPolicy} disabled={Boolean(editing?.format_locked)} onChange={(event) => setForm({ ...form, resetPolicy: event.target.value as DocumentNumberSeriesForm['resetPolicy'] })} data-testid="reset-policy-select">
                <option value="NONE">Không đánh lại số</option>
                <option value="YEARLY">Theo năm</option>
                <option value="MONTHLY">Theo tháng</option>
              </select>
            </label>
          </div>
        </Modal>
      </main>
    </AppShell>
  );
}
