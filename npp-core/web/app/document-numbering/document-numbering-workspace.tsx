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

const EMPTY_FORM: DocumentNumberSeriesForm = {
  code: '', documentType: 'SALES_ORDER', name: '', prefix: 'SO-',
  numberTemplate: '{PREFIX}{YYYY}{MM}-{SEQ}', resetPolicy: 'MONTHLY',
  sequenceWidth: '6', startCounter: '1', timezoneName: 'Asia/Ho_Chi_Minh',
  description: '', isActive: true,
};

function todayInVietnam() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function seriesToForm(series: DocumentNumberSeries): DocumentNumberSeriesForm {
  return {
    code: series.code,
    documentType: series.document_type,
    name: series.name,
    prefix: series.prefix,
    numberTemplate: series.number_template,
    resetPolicy: series.reset_policy,
    sequenceWidth: String(series.sequence_width),
    startCounter: String(series.start_counter),
    timezoneName: series.timezone_name,
    description: series.description ?? '',
    isActive: series.is_active,
  };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { code?: string; message?: string } };
  if (!response.ok || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new Error(payload.error?.message || payload.error?.code || 'Yêu cầu không thành công');
  }
  return payload.data as T;
}

function idempotencyKey(prefix: string) {
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
  const [allocationKey, setAllocationKey] = useState(() => idempotencyKey('test-number'));
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
      return [item.code, item.document_type, item.name, item.prefix].some((value) => value.toLowerCase().includes(query));
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
      .catch((value) => setError(value instanceof Error ? value.message : 'Không thể tải series'))
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
        ...form,
        sequenceWidth: Number(form.sequenceWidth),
        startCounter: form.startCounter,
        description: form.description || null,
        ...(editing ? { expectedUpdatedAt: editing.updated_at } : {}),
      };
      const saved = editing
        ? await requestJson<DocumentNumberSeries>(`/api/document-number-series/${editing.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await requestJson<DocumentNumberSeries>('/api/document-number-series', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey('series') },
            body: JSON.stringify(body),
          });
      setShowForm(false);
      setEditing(saved);
      const refreshed = await loadSeries(saved.id);
      if (refreshed) await loadHistory(refreshed.id);
      setNotice(editing ? 'Đã cập nhật series số chứng từ' : 'Đã tạo series số chứng từ');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Không thể lưu series');
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
      setNotice(saved.is_active ? 'Đã kích hoạt series' : 'Đã ngừng series');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Không thể đổi trạng thái series');
    } finally {
      setBusy(false);
    }
  }

  async function allocateTestNumber() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setLastAllocation(null);
    try {
      const saved = await requestJson<DocumentNumberAllocation>(`/api/document-number-series/${selected.id}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': allocationKey },
        body: JSON.stringify({ documentDate, metadata: { purpose: 'admin_test_allocation' } }),
      });
      setLastAllocation(saved);
      await loadHistory(selected.id);
      const refreshed = await loadSeries(selected.id);
      if (refreshed) setSelected(refreshed);
      setNotice(saved.replayed
        ? 'Đã trả lại số cũ theo khóa idempotency; không cấp thêm số'
        : 'Đã cấp một số kiểm thử và ghi lịch sử bất biến');
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Không thể cấp số kiểm thử');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Số chứng từ" subtitle="Quản lý series và cấp số an toàn; màn này không tạo chứng từ nghiệp vụ" kicker="NPP Document Numbering">
      <main className={styles.workspace} data-testid="document-numbering-page">
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Phase 3.3F</span>
            <h2>Bộ máy cấp số dùng chung</h2>
            <p>Cấu hình mẫu số theo từng loại chứng từ. Series đã phát sinh số sẽ khóa định dạng để bảo vệ lịch sử.</p>
          </div>
          <button type="button" className={styles.primaryButton} onClick={openCreate} data-testid="add-number-series-button">Thêm series</button>
        </section>

        {error && !showForm ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
        {notice ? <div className={styles.noticeBanner} data-testid="numbering-notice">{notice}</div> : null}

        <section className={styles.panel}>
          <div className={styles.filters}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm mã, loại chứng từ hoặc tên" data-testid="number-series-search" />
            <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Đã ngừng</option>
            </select>
            <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void loadSeries(selected?.id)}>Làm mới</button>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead><tr><th>Mã</th><th>Loại chứng từ</th><th>Mẫu</th><th>Reset</th><th>Đã cấp</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
              <tbody>
                {visibleSeries.map((item) => (
                  <tr key={item.id} data-testid={`number-series-row-${item.code}`} className={selected?.id === item.id ? styles.selectedRow : undefined}>
                    <td><strong>{item.code}</strong><small>{item.name}</small></td>
                    <td>{item.document_type}</td>
                    <td><code>{item.number_template}</code>{item.format_locked ? <span className={styles.locked}>Đã khóa</span> : null}</td>
                    <td>{item.reset_policy}</td>
                    <td>{item.allocation_count}</td>
                    <td>{item.is_active ? 'Hoạt động' : 'Ngừng'}</td>
                    <td className={styles.actions}>
                      <button type="button" onClick={() => void selectSeries(item)} data-testid={`select-number-series-${item.code}`}>Chi tiết</button>
                      <button type="button" onClick={() => openEdit(item)}>Sửa</button>
                      <button type="button" disabled={busy} onClick={() => void toggleActive(item)}>{item.is_active ? 'Vô hiệu' : 'Kích hoạt'}</button>
                    </td>
                  </tr>
                ))}
                {visibleSeries.length === 0 ? <tr><td colSpan={7} className={styles.empty}>Chưa có series phù hợp</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        {selected ? (
          <section className={styles.detailGrid} data-testid="number-series-detail">
            <div className={styles.panel}>
              <div className={styles.sectionHeader}>
                <div><span className={styles.eyebrow}>Cấp số kiểm thử</span><h3>{selected.code} — {selected.name}</h3></div>
                <span className={selected.is_active ? styles.activeBadge : styles.inactiveBadge}>{selected.is_active ? 'Hoạt động' : 'Ngừng'}</span>
              </div>
              <p className={styles.warning}>Thao tác này tạo một allocation bất biến để kiểm thử bộ đếm. Nó không tạo đơn bán, phiếu kho, hóa đơn hay bút toán.</p>
              <div className={styles.formGrid}>
                <label>Ngày chứng từ<input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} data-testid="allocation-date-input" /></label>
                <label>Khóa idempotency<input value={allocationKey} onChange={(event) => setAllocationKey(event.target.value)} data-testid="allocation-key-input" /></label>
              </div>
              <div className={styles.actionsBar}>
                <button type="button" className={styles.primaryButton} disabled={busy || !selected.is_active || !documentDate || !allocationKey.trim()} onClick={() => void allocateTestNumber()} data-testid="allocate-test-number-button">Cấp số kiểm thử</button>
                <button type="button" className={styles.secondaryButton} onClick={() => setAllocationKey(idempotencyKey('test-number'))}>Tạo khóa mới</button>
              </div>
              {lastAllocation ? (
                <div className={styles.result} data-testid="allocation-result">
                  <span>{lastAllocation.replayed ? 'Replay' : 'Số mới'}</span>
                  <strong>{lastAllocation.document_number}</strong>
                  <small>Kỳ {lastAllocation.period_key} · bộ đếm {lastAllocation.counter_value}</small>
                </div>
              ) : null}
            </div>

            <div className={styles.panel}>
              <div className={styles.sectionHeader}><div><span className={styles.eyebrow}>Bộ đếm</span><h3>Trạng thái theo kỳ</h3></div></div>
              <div className={styles.counterList}>
                {history.counters.map((counter) => (
                  <div key={counter.period_key} className={styles.counterCard}>
                    <strong>{counter.period_key}</strong><span>Số kế tiếp</span><b>{counter.next_counter}</b>
                  </div>
                ))}
                {history.counters.length === 0 ? <p>Chưa phát sinh bộ đếm.</p> : null}
              </div>
            </div>

            <div className={`${styles.panel} ${styles.fullWidth}`}>
              <div className={styles.sectionHeader}>
                <div><span className={styles.eyebrow}>Lịch sử bất biến</span><h3>Các số đã cấp</h3></div>
                <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void loadHistory(selected.id)}>Làm mới lịch sử</button>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead><tr><th>Số chứng từ</th><th>Ngày chứng từ</th><th>Kỳ</th><th>Bộ đếm</th><th>Cấp lúc</th></tr></thead>
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
          title={editing ? `Sửa ${editing.code}` : 'Tạo series số chứng từ'}
          description="Thiết lập mẫu số, chu kỳ đánh lại và số thứ tự bắt đầu."
          onClose={closeForm}
          testId="number-series-modal"
          size="large"
          footer={(
            <>
              <button type="button" className={styles.secondaryButton} disabled={busy} onClick={closeForm}>Hủy</button>
              <button type="button" className={styles.primaryButton} disabled={busy || !form.code.trim() || !form.name.trim()} onClick={() => void saveSeries()} data-testid="save-number-series-button">Lưu series</button>
            </>
          )}
        >
          {error ? <div className={styles.errorBanner} role="alert">{error}</div> : null}
          {editing?.format_locked ? <p className={styles.warning}>Định dạng đã khóa vì series có lịch sử cấp số.</p> : null}
          <div className={styles.formGrid} data-testid="number-series-form">
            <label>Mã series<input value={form.code} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} data-testid="number-series-code-input" /></label>
            <label>Loại chứng từ<input value={form.documentType} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, documentType: event.target.value.toUpperCase() })} data-testid="document-type-input" /></label>
            <label>Tên series<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} data-testid="number-series-name-input" /></label>
            <label>Tiền tố<input value={form.prefix} disabled={Boolean(editing?.format_locked)} onChange={(event) => setForm({ ...form, prefix: event.target.value.toUpperCase() })} data-testid="number-prefix-input" /></label>
            <label className={styles.wide}>Mẫu số<input value={form.numberTemplate} disabled={Boolean(editing?.format_locked)} onChange={(event) => setForm({ ...form, numberTemplate: event.target.value.toUpperCase() })} data-testid="number-template-input" /><small>Token: {'{PREFIX}'} {'{YYYY}'} {'{YY}'} {'{MM}'} {'{SEQ}'}</small></label>
            <label>Reset<select value={form.resetPolicy} disabled={Boolean(editing?.format_locked)} onChange={(event) => setForm({ ...form, resetPolicy: event.target.value as DocumentNumberSeriesForm['resetPolicy'] })} data-testid="reset-policy-select"><option value="NONE">Không reset</option><option value="YEARLY">Theo năm</option><option value="MONTHLY">Theo tháng</option></select></label>
            <label>Độ rộng số<input type="number" min="1" max="18" value={form.sequenceWidth} disabled={Boolean(editing?.format_locked)} onChange={(event) => setForm({ ...form, sequenceWidth: event.target.value })} data-testid="sequence-width-input" /></label>
            <label>Số bắt đầu<input value={form.startCounter} disabled={Boolean(editing?.format_locked)} onChange={(event) => setForm({ ...form, startCounter: event.target.value })} data-testid="start-counter-input" /></label>
            <label>Múi giờ<input value={form.timezoneName} disabled={Boolean(editing?.format_locked)} onChange={(event) => setForm({ ...form, timezoneName: event.target.value })} /></label>
            <label className={styles.wide}>Mô tả<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          </div>
          <label className={styles.check}><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} /> Hoạt động</label>
        </Modal>
      </main>
    </AppShell>
  );
}
