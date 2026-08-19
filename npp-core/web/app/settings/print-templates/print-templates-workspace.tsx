'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell-core';
import type { DocumentPrintTemplate } from '../../../lib/document-print-template-types';
import SettingsTabs from '../settings-tabs';
import styles from './print-templates.module.css';

type Envelope<T> = { data?: T; error?: { message?: string; retryable?: boolean } };
type RequestFailure = Error & { retryable?: boolean };

function templateLabel(template: DocumentPrintTemplate) {
  return template.name;
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const keys = useRef(new Map<string, string>());

  const selected = useMemo(
    () => templates.find((item) => `${item.documentType}:${item.templateCode}` === selectedKey) ?? null,
    [selectedKey, templates],
  );

  function applySelection(template: DocumentPrintTemplate | null) {
    setPageSize(template?.pageSize ?? 'A4');
    setVisibleFieldKeys(template?.visibleFieldKeys ?? []);
  }

  async function refresh(preferredKey?: string) {
    const next = await request<DocumentPrintTemplate[]>('/api/document-print-templates');
    setTemplates(next);
    const selected = next.find((item) => `${item.documentType}:${item.templateCode}` === (preferredKey ?? selectedKey)) ?? next[0] ?? null;
    setSelectedKey(selected ? `${selected.documentType}:${selected.templateCode}` : '');
    applySelection(selected);
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
          : { pageSize, visibleFieldKeys, expectedUpdatedAt: selected.updatedAt }),
      });
      keys.current.delete(intent);
      setNotice(resetToDefault ? 'Đã khôi phục mẫu in mặc định.' : 'Đã lưu cấu hình mẫu in dùng chung.');
      await refresh(`${saved.documentType}:${saved.templateCode}`);
    } catch (cause) {
      if (!(cause as RequestFailure)?.retryable) keys.current.delete(intent);
      setError(cause instanceof Error ? cause.message : 'Không thể lưu cấu hình mẫu in');
    } finally { setBusy(''); }
  }

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
              <section><h3>Thông tin được in</h3><p className={styles.helper}>Bỏ chọn mục không cần xuất hiện trên mẫu này.</p><div className={styles.fieldGrid}>
                {selected.fields.map((field) => <label key={field.key} className={styles.fieldChoice}><input type="checkbox" checked={visibleFieldKeys.includes(field.key)} onChange={() => toggleField(field.key)} disabled={Boolean(busy)} /><span>{field.label}</span></label>)}
              </div></section>
              <aside className={styles.preview} aria-label="Xem trước mẫu in">
                <h3>Xem trước</h3><div className={`${styles.paper} ${pageSize === 'A5' ? styles.a5 : ''}`}><strong>HƯNG PHÁT</strong><h4>{selected.name.toUpperCase()}</h4><span>Số: CT-2026-000001</span><hr />
                  {selected.fields.filter((field) => visibleFieldKeys.includes(field.key)).slice(0, 7).map((field) => <p key={field.key}><b>{field.label}</b><span> Dữ liệu chứng từ</span></p>)}
                  {visibleFieldKeys.length > 7 ? <small>và {visibleFieldKeys.length - 7} mục khác</small> : null}
                </div><label className={styles.pageSize}><span>Khổ giấy</span><select value={pageSize} onChange={(event) => setPageSize(event.target.value as 'A4' | 'A5')} disabled={Boolean(busy)}><option value="A4">A4</option><option value="A5">A5</option></select></label>
              </aside>
            </div>
            <div className={styles.actions}><button type="button" className={styles.primary} disabled={Boolean(busy) || visibleFieldKeys.length === 0} onClick={() => void save(false)}>{busy.endsWith('.save') ? 'Đang lưu…' : 'Lưu cấu hình'}</button><button type="button" className={styles.secondary} disabled={Boolean(busy) || !selected.isCustomized} onClick={() => void save(true)}>{busy.endsWith('.reset') ? 'Đang khôi phục…' : 'Khôi phục mặc định'}</button></div>
          </> : <p className={styles.empty}>{loading ? 'Đang tải mẫu in…' : 'Chưa có mẫu in để cấu hình.'}</p>}
        </section>
      </main>
    </AppShell>
  );
}
