'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import printStyles from '../../components/business-document-print.module.css';
import type { DocumentPrintTemplate, PrintHeaderAlignment } from '../../../lib/document-print-template-types';
import SettingsTabs from '../settings-tabs';
import styles from './print-templates.module.css';

type Envelope<T> = { data?: T; error?: { message?: string; retryable?: boolean } };
type RequestFailure = Error & { retryable?: boolean };

const ALIGNMENT_OPTIONS: ReadonlyArray<Readonly<{ value: PrintHeaderAlignment; label: string }>> = [
  { value: 'left', label: 'Trái' },
  { value: 'center', label: 'Giữa' },
  { value: 'right', label: 'Phải' },
];

function templateLabel(template: DocumentPrintTemplate) {
  return template.name;
}

function fallbackHeading(template: DocumentPrintTemplate | null): string {
  return template?.documentType === 'SALES_ORDER' ? 'Hưng Phát' : '';
}

function previewValue(key: string): string {
  if (key === 'customer') return 'Khách hàng mẫu';
  if (key === 'document_date') return '09/09/2026';
  if (key === 'warehouse') return 'Kho Công Ty';
  if (key === 'delivery_method') return 'Giao thủ công';
  if (key === 'line_item') return 'Tên sản phẩm';
  if (key === 'line_quantity') return '2';
  if (key === 'line_unit') return 'Thùng';
  if (key === 'line_unit_price') return '125.000';
  if (key === 'line_total') return '250.000';
  if (key.startsWith('total_')) return '250.000 ₫';
  return 'Dữ liệu chứng từ';
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !payload || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw Object.assign(new Error(payload?.error?.message || 'Không thể tải cấu hình mẫu in'), { retryable: payload?.error?.retryable === true });
  }
  return payload.data as T;
}

export default function PrintTemplatesWorkspace() {
  const [templates, setTemplates] = useState<DocumentPrintTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [pageSize, setPageSize] = useState<'A4' | 'A5'>('A4');
  const [visibleFieldKeys, setVisibleFieldKeys] = useState<string[]>([]);
  const [heading, setHeading] = useState('');
  const [headingVisible, setHeadingVisible] = useState(true);
  const [headingAlign, setHeadingAlign] = useState<PrintHeaderAlignment>('left');
  const [titleAlign, setTitleAlign] = useState<PrintHeaderAlignment>('right');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const keys = useRef(new Map<string, string>());

  const selected = useMemo(
    () => templates.find((item) => `${item.documentType}:${item.templateCode}` === selectedKey) ?? null,
    [selectedKey, templates],
  );

  const previewMeta = useMemo(() => selected?.fields.filter((field) => (
    visibleFieldKeys.includes(field.key)
    && !field.key.startsWith('line_')
    && !field.key.startsWith('total_')
    && !['note', 'signatures', 'status'].includes(field.key)
  )).slice(0, 4) ?? [], [selected, visibleFieldKeys]);
  const previewColumns = useMemo(() => selected?.fields.filter((field) => visibleFieldKeys.includes(field.key) && field.key.startsWith('line_')).slice(0, 6) ?? [], [selected, visibleFieldKeys]);
  const previewTotals = useMemo(() => selected?.fields.filter((field) => visibleFieldKeys.includes(field.key) && field.key.startsWith('total_')).slice(-3) ?? [], [selected, visibleFieldKeys]);

  function applySelection(template: DocumentPrintTemplate | null) {
    setPageSize(template?.pageSize ?? 'A4');
    setVisibleFieldKeys(template?.visibleFieldKeys ?? []);
    setHeading(template?.heading ?? fallbackHeading(template));
    setHeadingVisible(template?.headingVisible ?? true);
    setHeadingAlign(template?.headingAlign ?? 'left');
    setTitleAlign(template?.titleAlign ?? 'right');
  }

  async function refresh(preferredKey?: string) {
    const next = await request<DocumentPrintTemplate[]>('/api/document-print-templates');
    setTemplates(next);
    const nextSelected = next.find((item) => `${item.documentType}:${item.templateCode}` === (preferredKey ?? selectedKey)) ?? next[0] ?? null;
    setSelectedKey(nextSelected ? `${nextSelected.documentType}:${nextSelected.templateCode}` : '');
    applySelection(nextSelected);
  }

  useEffect(() => {
    void refresh()
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Không thể tải cấu hình mẫu in'))
      .finally(() => setLoading(false));
  }, []);

  function toggleField(key: string) {
    setVisibleFieldKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function keyFor(intent: string) {
    const current = keys.current.get(intent);
    if (current) return current;
    const next = createIdempotencyKey(intent);
    keys.current.set(intent, next);
    return next;
  }

  async function save(resetToDefault = false) {
    if (!selected || busy) return;
    const intent = `print-template.${selected.documentType}.${selected.templateCode}.${resetToDefault ? 'reset' : 'save'}`;
    setBusy(intent); setError(''); setNotice('');
    try {
      const saved = await request<DocumentPrintTemplate>(`/api/document-print-templates/${selected.documentType}/${selected.templateCode}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor(intent) },
        body: JSON.stringify(resetToDefault
          ? { resetToDefault: true, expectedUpdatedAt: selected.updatedAt }
          : {
            pageSize,
            visibleFieldKeys,
            heading: heading.trim() || null,
            headingVisible,
            headingAlign,
            titleAlign,
            expectedUpdatedAt: selected.updatedAt,
          }),
      });
      keys.current.delete(intent);
      setNotice(resetToDefault ? 'Đã khôi phục mẫu in mặc định.' : 'Đã lưu cấu hình mẫu in dùng chung.');
      await refresh(`${saved.documentType}:${saved.templateCode}`);
    } catch (cause) {
      if (!(cause as RequestFailure)?.retryable) keys.current.delete(intent);
      setError(cause instanceof Error ? cause.message : 'Không thể lưu cấu hình mẫu in');
    } finally { setBusy(''); }
  }

  const previewHeading = heading.trim() || fallbackHeading(selected);
  const previewTitle = selected?.title?.trim() || selected?.name || '';

  return (
    <AppShell title="Cài đặt" subtitle="Thiết lập mẫu in dùng chung cho các chứng từ của Công Ty." kicker="Hệ thống">
      <SettingsTabs active="print-templates" />
      <main className={styles.workspace} data-testid="print-templates-page">
        <section className={styles.hero}>
          <div><p className={styles.eyebrow}>Mẫu in</p><h2>Cấu hình mẫu in dùng chung</h2><p>Chọn từng loại phiếu, khổ giấy và các thông tin cần in. Cấu hình được dùng chung khi mở chứng từ tương ứng.</p></div>
          {selected ? <span className={selected.isCustomized ? styles.customBadge : styles.defaultBadge}>{selected.isCustomized ? 'Đang dùng cấu hình riêng' : 'Đang dùng mặc định'}</span> : null}
        </section>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        <section className={styles.panel}>
          <label className={styles.selector}><span>Loại chứng từ / mẫu in</span><select value={selectedKey} disabled={loading || !templates.length} onChange={(event) => { const next = templates.find((item) => `${item.documentType}:${item.templateCode}` === event.target.value) ?? null; setSelectedKey(event.target.value); applySelection(next); setError(''); setNotice(''); }}>
            {templates.map((item) => <option key={`${item.documentType}:${item.templateCode}`} value={`${item.documentType}:${item.templateCode}`}>{templateLabel(item)}</option>)}
          </select></label>
          {selected ? <>
            <div className={styles.contentGrid}>
              <section>
                <div className={styles.headerConfig}>
                  <h3>Phần đầu phiếu</h3>
                  <p className={styles.helper}>Chỉ tùy chỉnh Tên Công Ty và vị trí hai phần đầu phiếu.</p>
                  <div className={styles.headerConfigGrid}>
                    <div className={styles.headerCard}>
                      <div className={styles.headerCardTitle}><strong>Tên Công Ty</strong><label className={styles.inlineCheck}><input type="checkbox" checked={headingVisible} onChange={(event) => setHeadingVisible(event.target.checked)} disabled={Boolean(busy)} /><span>Hiển thị</span></label></div>
                      <label className={styles.control}><span>Nội dung</span><input value={heading} onChange={(event) => setHeading(event.target.value)} maxLength={160} disabled={Boolean(busy)} placeholder="Nhập tên Công Ty" /></label>
                      <label className={styles.control}><span>Vị trí</span><select value={headingAlign} onChange={(event) => setHeadingAlign(event.target.value as PrintHeaderAlignment)} disabled={Boolean(busy)}>{ALIGNMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    </div>
                    <div className={styles.headerCard}>
                      <div className={styles.headerCardTitle}><strong>Loại đơn</strong><span className={styles.readonlyValue}>{previewTitle}</span></div>
                      <label className={styles.control}><span>Vị trí</span><select value={titleAlign} onChange={(event) => setTitleAlign(event.target.value as PrintHeaderAlignment)} disabled={Boolean(busy)}>{ALIGNMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    </div>
                  </div>
                </div>

                <h3>Thông tin được in</h3><p className={styles.helper}>Bỏ chọn mục không cần xuất hiện. Mục ghi “Luôn in” là thông tin bắt buộc của chứng từ.</p><div className={styles.fieldGrid}>
                  {selected.fields.map((field) => <label key={field.key} className={styles.fieldChoice}><input type="checkbox" checked={visibleFieldKeys.includes(field.key)} onChange={() => toggleField(field.key)} disabled={Boolean(busy) || field.required} /><span>{field.label}{field.required ? ' · Luôn in' : ''}</span></label>)}
                </div>
              </section>
              <aside className={styles.preview} aria-label="Xem trước mẫu in">
                <h3>Xem trước</h3>
                <div className={`${styles.paper} ${pageSize === 'A5' ? styles.a5 : ''}`}>
                  <article className={printStyles.sheet}>
                    <header className={printStyles.header}>
                      {headingVisible && previewHeading ? <div className={printStyles.brandBlock} style={{ textAlign: headingAlign }}><strong className={printStyles.brand}>{previewHeading}</strong></div> : null}
                      <div className={printStyles.titleBlock} style={{ textAlign: titleAlign }}><h1>{previewTitle}</h1><p>Số: <strong>CT-2026-000001</strong></p></div>
                    </header>
                    {previewMeta.length ? <section className={printStyles.metaGrid}>{previewMeta.map((field) => <div className={printStyles.metaItem} key={field.key}><span>{field.label}</span><strong>{previewValue(field.key)}</strong></div>)}</section> : null}
                    {previewColumns.length ? <table className={printStyles.table}><thead><tr>{previewColumns.map((field) => <th key={field.key}>{field.label}</th>)}</tr></thead><tbody><tr>{previewColumns.map((field) => <td key={field.key}>{previewValue(field.key)}</td>)}</tr></tbody></table> : null}
                    {previewTotals.length ? <section className={printStyles.summary}>{previewTotals.map((field) => <div className={printStyles.summaryRow} key={field.key}><span>{field.label}</span><strong>{previewValue(field.key)}</strong></div>)}</section> : null}
                    {visibleFieldKeys.includes('signatures') ? <footer className={printStyles.signatures}><div><strong>Người lập</strong><span>(Ký, ghi rõ họ tên)</span></div><div><strong>Bộ phận liên quan</strong><span>(Ký, ghi rõ họ tên)</span></div><div><strong>Khách hàng</strong><span>(Ký, ghi rõ họ tên)</span></div></footer> : null}
                  </article>
                </div>
                <label className={styles.pageSize}><span>Khổ giấy</span><select value={pageSize} onChange={(event) => setPageSize(event.target.value as 'A4' | 'A5')} disabled={Boolean(busy)}><option value="A4">A4</option><option value="A5">A5</option></select></label>
              </aside>
            </div>
            <div className={styles.actions}><button type="button" className={styles.primary} disabled={Boolean(busy) || visibleFieldKeys.length === 0} onClick={() => void save(false)}>{busy.endsWith('.save') ? 'Đang lưu…' : 'Lưu cấu hình'}</button><button type="button" className={styles.secondary} disabled={Boolean(busy) || !selected.isCustomized} onClick={() => void save(true)}>{busy.endsWith('.reset') ? 'Đang khôi phục…' : 'Khôi phục mặc định'}</button></div>
          </> : <p className={styles.empty}>{loading ? 'Đang tải mẫu in…' : 'Chưa có mẫu in để cấu hình.'}</p>}
        </section>
      </main>
    </AppShell>
  );
}
