'use client';

import { useMemo, useState } from 'react';
import type { InventoryBalance } from '../../../lib/inventory-types';
import { normalizeSearch } from '../../../lib/inventory-types';
import styles from '../inventory-workspace.module.css';

type Props = Readonly<{
  warehouseId: string;
  warehouseName: string;
  currentSku: string;
  balances: InventoryBalance[];
}>;

type ErrorEnvelope = Readonly<{ error?: { message?: string } }>;

function splitSkus(value: string): string[] {
  return [...new Set(value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export default function InventoryHistoryExportAction({ warehouseId, warehouseName, currentSku, balances }: Props) {
  const [open, setOpen] = useState(false);
  const [skuText, setSkuText] = useState(currentSku);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const skuMap = useMemo(() => {
    const map = new Map<string, { baseVariantId: string; sku: string }>();
    for (const balance of balances) {
      if (balance.warehouse_id !== warehouseId) continue;
      const candidates = [balance.base_sku, balance.package_sku].filter(Boolean) as string[];
      for (const sku of candidates) map.set(normalizeSearch(sku), { baseVariantId: balance.base_variant_id, sku });
    }
    return map;
  }, [balances, warehouseId]);

  function showDialog() {
    setSkuText(currentSku);
    setError('');
    setOpen(true);
  }

  async function exportHistory() {
    const requested = splitSkus(skuText);
    if (!requested.length) { setError('Nhập ít nhất một mã hàng.'); return; }
    if (requested.length > 20) { setError('Mỗi lần xuất tối đa 20 mã hàng.'); return; }
    const resolved: Array<{ baseVariantId: string; sku: string }> = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const input of requested) {
      const match = skuMap.get(normalizeSearch(input));
      if (!match) { missing.push(input); continue; }
      if (seen.has(match.baseVariantId)) continue;
      seen.add(match.baseVariantId);
      resolved.push({ baseVariantId: match.baseVariantId, sku: input });
    }
    if (missing.length) { setError('Không tìm thấy tại kho này: ' + missing.join(', ') + '.'); return; }

    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams({ warehouseId });
      for (const item of resolved) {
        query.append('baseVariantId', item.baseVariantId);
        query.append('sku', item.sku);
      }
      const response = await fetch('/api/inventory/balances/history/export?' + query.toString(), { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as ErrorEnvelope | null;
        throw new Error(payload?.error?.message || 'Không xuất được lịch sử kho.');
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]+)"/i.exec(disposition)?.[1] || 'Lich-su-kho.xlsx';
      downloadBlob(await response.blob(), filename);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không xuất được lịch sử kho.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.primaryAction} onClick={showDialog}>Xuất lịch sử</button>
      {open ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
          <section className={styles.documentDialog} role="dialog" aria-modal="true" aria-labelledby="inventory-history-export-title">
            <div className={styles.documentDialogHeader}>
              <div>
                <div className={styles.subtle}>Xuất Excel · {warehouseName}</div>
                <h2 id="inventory-history-export-title" className={styles.panelTitle}>Lịch sử kho theo mã hàng</h2>
              </div>
              <button type="button" className={styles.miniButton} onClick={() => setOpen(false)} disabled={busy}>Đóng</button>
            </div>
            <label className={styles.field}>
              <span>Mã hàng cần xuất</span>
              <textarea className={styles.textInput} rows={5} value={skuText} onChange={(event) => setSkuText(event.target.value)} disabled={busy} placeholder={'Ví dụ: SBALAN\nSKU-002'} />
              <small className={styles.subtle}>Nhập một hoặc nhiều mã, ngăn cách bằng xuống dòng, dấu phẩy hoặc dấu chấm phẩy. Mỗi mã hàng sẽ nằm ở một sheet Excel riêng.</small>
            </label>
            {error ? <div className={[styles.banner, styles.bannerError].join(' ')} role="alert">{error}</div> : null}
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryAction} onClick={() => void exportHistory()} disabled={busy}>
                {busy ? 'Đang tạo file…' : 'Tải Excel'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
