'use client';

import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import {
  formatDate,
  formatDateTime,
  formatQuantity,
  matchTerm,
  normalizeSearch,
  type InventoryBalance,
} from '../../../lib/inventory-types';
import {
  STOCKTAKE_PERMISSION_KEYS,
  STOCKTAKE_STATUS_LABELS,
  type Stocktake,
  type StocktakeLine,
  type StocktakeStatus,
} from '../../../lib/stocktake-types';
import styles from './stocktake-workspace.module.css';

type Props = {
  initialStocktakes: Stocktake[];
  balances: InventoryBalance[];
  initialPermissionKeys: string[];
  initialError: string | null;
  initialLookupError: string | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

function uniqueScopes(balances: InventoryBalance[]) {
  const seen = new Set<string>();
  return balances.filter((balance) => {
    const key = `${balance.warehouse_id}:${balance.location_id ?? '<null>'}:${balance.base_variant_id}:${balance.lot_id ?? '<null>'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function statusTone(status: StocktakeStatus): string {
  if (status === 'posted') return styles.success;
  if (status === 'reversed' || status === 'cancelled') return styles.muted;
  if (status === 'submitted' || status === 'approved') return styles.warning;
  if (status === 'recount_required') return styles.danger;
  return styles.info;
}

function lineLabel(line: StocktakeLine): string {
  return [line.locationCode || 'Không vị trí', line.baseSku, line.lotCode || 'Không lô'].join(' · ');
}

export default function StocktakeWorkspace({
  initialStocktakes,
  balances,
  initialPermissionKeys,
  initialError,
  initialLookupError,
}: Props) {
  const [stocktakes, setStocktakes] = useState(initialStocktakes);
  const [selectedId, setSelectedId] = useState(initialStocktakes[0]?.id ?? '');
  const [detail, setDetail] = useState<Stocktake | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || initialLookupError);
  const [message, setMessage] = useState('');
  const idempotencyKeys = useRef(new Map<string, string>());
  const permissions = useMemo(() => new Set(initialPermissionKeys), [initialPermissionKeys]);
  const scopeBalances = useMemo(() => uniqueScopes(balances), [balances]);
  const warehouses = useMemo(() => {
    const rows = new Map<string, { id: string; code: string; name: string }>();
    for (const balance of scopeBalances) {
      rows.set(balance.warehouse_id, {
        id: balance.warehouse_id,
        code: balance.warehouse_code,
        name: balance.warehouse_name,
      });
    }
    return [...rows.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [scopeBalances]);
  const availableScopes = useMemo(
    () => scopeBalances.filter((balance) => balance.warehouse_id === warehouseId),
    [scopeBalances, warehouseId],
  );
  const filtered = useMemo(() => {
    const term = normalizeSearch(search);
    return stocktakes.filter((stocktake) => {
      if (statusFilter && stocktake.status !== statusFilter) return false;
      return !term || matchTerm(
        stocktake.stocktakeNumber,
        stocktake.warehouseCode,
        stocktake.warehouseName,
        stocktake.status,
      ).includes(term);
    });
  }, [search, statusFilter, stocktakes]);

  const can = (key: string) => permissions.has(key);

  function stableKey(action: string, id: string, revision: string): string {
    const mapKey = `${action}:${id}:${revision}`;
    const existing = idempotencyKeys.current.get(mapKey);
    if (existing) return existing;
    const created = `web-stocktake-${action}-${crypto.randomUUID()}`;
    idempotencyKeys.current.set(mapKey, created);
    return created;
  }

  function remember(next: Stocktake) {
    setDetail(next);
    setSelectedId(next.id);
    setStocktakes((current) => {
      const found = current.some((item) => item.id === next.id);
      const summary = { ...next, rounds: undefined, lines: undefined };
      return found
        ? current.map((item) => item.id === next.id ? summary : item)
        : [summary, ...current];
    });
    setCounts(Object.fromEntries((next.lines ?? []).map((line) => [line.id, line.countedBaseQuantity ?? ''])));
  }

  async function parseResponse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
    if (!response.ok || !payload?.data) {
      const apiMessage = payload?.error?.message || 'Thao tác kiểm kê không thành công';
      throw new Error(apiMessage);
    }
    return payload.data;
  }

  async function loadDetail(id: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/inventory/stocktakes/${id}`, { cache: 'no-store' });
      const next = await parseResponse<Stocktake>(response);
      remember(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tải được chi tiết kiểm kê');
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    if (!warehouseId || selectedScopes.size === 0) {
      setError('Chọn kho và ít nhất một phạm vi vị trí/SKU/lô.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const scopes = availableScopes
        .filter((balance) => selectedScopes.has(`${balance.location_id ?? '<null>'}:${balance.base_variant_id}:${balance.lot_id ?? '<null>'}`))
        .map((balance) => ({
          locationId: balance.location_id,
          baseVariantId: balance.base_variant_id,
          lotId: balance.lot_id,
        }));
      const createFingerprint = `${warehouseId}:${[...selectedScopes].sort().join('|')}:${note.trim()}`;
      const response = await fetch('/api/inventory/stocktakes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': stableKey('create', warehouseId, createFingerprint),
        },
        body: JSON.stringify({ warehouseId, note: note.trim() || null, scopes }),
      });
      const next = await parseResponse<Stocktake>(response);
      remember(next);
      setShowCreate(false);
      setSelectedScopes(new Set());
      setNote('');
      setMessage('Đã tạo đợt kiểm kê. Số hệ thống được ẩn trong lúc đếm.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không tạo được kiểm kê');
    } finally {
      setBusy(false);
    }
  }

  async function transition(action: 'count' | 'submit' | 'recount' | 'approve' | 'post' | 'cancel' | 'reverse') {
    if (!detail) return;
    const payload: Record<string, unknown> = { expectedRevision: detail.revision };
    if (action === 'count') {
      const lines = detail.lines ?? [];
      if (lines.some((line) => !String(counts[line.id] ?? '').trim())) {
        setError('Phải nhập số đếm cho toàn bộ phạm vi của vòng hiện tại.');
        return;
      }
      payload.counts = lines.map((line) => ({ lineId: line.id, countedBaseQuantity: String(counts[line.id]).trim() }));
    }
    if (['recount', 'cancel', 'reverse'].includes(action)) {
      if (!reason.trim()) {
        setError('Nhập lý do trước khi thực hiện thao tác này.');
        return;
      }
      payload.reason = reason.trim();
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/inventory/stocktakes/${detail.id}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': stableKey(action, detail.id, detail.revision),
        },
        body: JSON.stringify(payload),
      });
      const next = await parseResponse<Stocktake>(response);
      remember(next);
      setReason('');
      setMessage({
        count: 'Đã hoàn tất vòng đếm.',
        submit: 'Đã gửi kết quả kiểm kê để duyệt.',
        recount: 'Đã mở vòng đếm lại và giữ nguyên lịch sử vòng trước.',
        approve: 'Đã duyệt kết quả kiểm kê.',
        post: next.inventoryMovementId ? 'Đã ghi sổ chênh lệch kiểm kê.' : 'Đã ghi nhận kiểm kê không chênh lệch.',
        cancel: 'Đã hủy đợt kiểm kê.',
        reverse: 'Đã đảo ghi sổ kiểm kê.',
      }[action]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Thao tác kiểm kê không thành công');
    } finally {
      setBusy(false);
    }
  }

  const actionButtons = detail ? (
    <div className={styles.actionRow} aria-label="Thao tác kiểm kê">
      {['draft', 'recount_required'].includes(detail.status) && can(STOCKTAKE_PERMISSION_KEYS.count) ? (
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => transition('count')}>Hoàn tất vòng đếm</button>
      ) : null}
      {detail.status === 'counted' && can(STOCKTAKE_PERMISSION_KEYS.submit) ? (
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => transition('submit')}>Gửi duyệt</button>
      ) : null}
      {['counted', 'submitted', 'approved'].includes(detail.status) && can(STOCKTAKE_PERMISSION_KEYS.approve) ? (
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => transition('recount')}>Yêu cầu đếm lại</button>
      ) : null}
      {detail.status === 'submitted' && can(STOCKTAKE_PERMISSION_KEYS.approve) ? (
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => transition('approve')}>Duyệt kết quả</button>
      ) : null}
      {detail.status === 'approved' && can(STOCKTAKE_PERMISSION_KEYS.post) ? (
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => transition('post')}>Ghi sổ chênh lệch</button>
      ) : null}
      {['draft', 'counted', 'recount_required'].includes(detail.status) && can(STOCKTAKE_PERMISSION_KEYS.cancel) ? (
        <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => transition('cancel')}>Hủy kiểm kê</button>
      ) : null}
      {detail.status === 'posted' && can(STOCKTAKE_PERMISSION_KEYS.reverse) ? (
        <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => transition('reverse')}>Đảo ghi sổ</button>
      ) : null}
    </div>
  ) : null;

  return (
    <AppShell
      kicker="Tồn kho & lô hàng"
      title="Kiểm kê kho"
      subtitle="Đếm mù, đếm lại có lịch sử, duyệt tách người và ghi sổ chênh lệch qua Inventory Ledger."
      actions={can(STOCKTAKE_PERMISSION_KEYS.create) ? (
        <button type="button" className={styles.primaryButton} onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? 'Đóng tạo mới' : 'Tạo đợt kiểm kê'}
        </button>
      ) : null}
    >
      <div className={styles.page} data-testid="stocktake-workspace">
        {showCreate ? (
          <section className={styles.createPanel} aria-labelledby="create-stocktake-title">
            <div>
              <h2 id="create-stocktake-title">Tạo đợt kiểm kê</h2>
              <p>Chọn exact vị trí, SKU cơ sở và lô. Số tồn hệ thống không hiển thị cho người đếm.</p>
            </div>
            <label>
              Kho kiểm kê
              <select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setSelectedScopes(new Set()); }}>
                <option value="">Chọn kho</option>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
              </select>
            </label>
            <label>
              Ghi chú
              <textarea value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} />
            </label>
            <div className={styles.scopeList} aria-label="Phạm vi kiểm kê">
              {availableScopes.length ? availableScopes.map((balance) => {
                const key = `${balance.location_id ?? '<null>'}:${balance.base_variant_id}:${balance.lot_id ?? '<null>'}`;
                return (
                  <label className={styles.scopeOption} key={key}>
                    <input
                      type="checkbox"
                      checked={selectedScopes.has(key)}
                      onChange={(event) => setSelectedScopes((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(key); else next.delete(key);
                        return next;
                      })}
                    />
                    <span><strong>{balance.base_sku}</strong> · {balance.location_code || 'Không vị trí'} · {balance.lot_code || 'Không lô'}</span>
                  </label>
                );
              }) : <p>Kho chưa có phạm vi tồn khả dụng để chọn.</p>}
            </div>
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryButton} disabled={busy} onClick={createNew}>Tạo và bắt đầu đếm</button>
            </div>
          </section>
        ) : null}

        <section className={styles.filters} aria-label="Bộ lọc kiểm kê">
          <label>
            Tìm kiếm
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Số kiểm kê, kho..." />
          </label>
          <label>
            Trạng thái
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Tất cả</option>
              {Object.entries(STOCKTAKE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </section>

        {error ? <div className={styles.alert} role="alert">{error}</div> : null}
        {message ? <div className={styles.statusMessage} role="status">{message}</div> : null}

        <div className={styles.workspace}>
          <section className={styles.listPanel} aria-label="Danh sách kiểm kê">
            {filtered.length ? filtered.map((stocktake) => (
              <button
                type="button"
                key={stocktake.id}
                className={`${styles.listItem} ${selectedId === stocktake.id ? styles.selected : ''}`}
                onClick={() => { setSelectedId(stocktake.id); loadDetail(stocktake.id); }}
              >
                <span className={styles.listHeader}><strong>{stocktake.stocktakeNumber}</strong><span className={`${styles.badge} ${statusTone(stocktake.status)}`}>{STOCKTAKE_STATUS_LABELS[stocktake.status]}</span></span>
                <span>{stocktake.warehouseCode} · {stocktake.warehouseName}</span>
                <span>Vòng {stocktake.currentRound} · {stocktake.lineCount} phạm vi</span>
                <small>{formatDateTime(stocktake.updatedAt)}</small>
              </button>
            )) : <p className={styles.empty}>Chưa có đợt kiểm kê phù hợp.</p>}
          </section>

          <section className={styles.detailPanel} aria-live="polite">
            {!detail ? <p className={styles.empty}>Chọn một đợt kiểm kê để xem và thao tác.</p> : (
              <>
                <header className={styles.detailHeader}>
                  <div>
                    <p className={styles.eyebrow}>{detail.warehouseCode} · Vòng {detail.currentRound}</p>
                    <h2>{detail.stocktakeNumber}</h2>
                    <p>{detail.note || 'Không có ghi chú'}</p>
                  </div>
                  <span className={`${styles.badge} ${statusTone(detail.status)}`}>{STOCKTAKE_STATUS_LABELS[detail.status]}</span>
                </header>

                {actionButtons}
                {['counted', 'submitted', 'approved', 'posted'].includes(detail.status) || ['recount_required', 'draft'].includes(detail.status) ? (
                  <label className={styles.reasonField}>
                    Lý do cho đếm lại, hủy hoặc đảo ghi sổ
                    <input value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} placeholder="Nhập khi thao tác yêu cầu lý do" />
                  </label>
                ) : null}

                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Phạm vi</th>
                        <th>Đơn vị</th>
                        {detail.lines?.some((line) => line.expectedBaseQuantity !== undefined) ? <th>Số hệ thống</th> : null}
                        <th>Thực đếm</th>
                        {['posted', 'reversed'].includes(detail.status) ? <th>Chênh lệch</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.lines ?? []).map((line) => (
                        <tr key={line.id}>
                          <td><strong>{lineLabel(line)}</strong>{line.expiryDate ? <small>HSD {formatDate(line.expiryDate)}</small> : null}</td>
                          <td>{line.sourceUnitCode}</td>
                          {detail.lines?.some((item) => item.expectedBaseQuantity !== undefined) ? <td>{line.expectedBaseQuantity === undefined ? 'Ẩn' : formatQuantity(line.expectedBaseQuantity)}</td> : null}
                          <td>
                            {['draft', 'recount_required'].includes(detail.status) ? (
                              <input
                                className={styles.quantityInput}
                                inputMode="decimal"
                                aria-label={`Số thực đếm ${lineLabel(line)}`}
                                value={counts[line.id] ?? ''}
                                onChange={(event) => setCounts((current) => ({ ...current, [line.id]: event.target.value }))}
                              />
                            ) : formatQuantity(line.countedBaseQuantity ?? '0')}
                          </td>
                          {['posted', 'reversed'].includes(detail.status) ? <td>{formatQuantity(line.finalDelta ?? '0')}</td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <section className={styles.history} aria-labelledby="round-history-title">
                  <h3 id="round-history-title">Lịch sử vòng đếm</h3>
                  <ol>
                    {(detail.rounds ?? []).map((round) => (
                      <li key={round.id}>
                        <strong>Vòng {round.roundNumber} · {round.status}</strong>
                        <span>Tạo bởi {round.createdBy} lúc {formatDateTime(round.createdAt)}</span>
                        {round.reason ? <span>Lý do: {round.reason}</span> : null}
                      </li>
                    ))}
                  </ol>
                </section>

                <dl className={styles.meta}>
                  <div><dt>Người gửi</dt><dd>{detail.submittedBy || '—'}</dd></div>
                  <div><dt>Người duyệt</dt><dd>{detail.approvedBy || '—'}</dd></div>
                  <div><dt>Movement</dt><dd>{detail.inventoryMovementId || 'Không tạo movement'}</dd></div>
                  <div><dt>Cập nhật</dt><dd>{formatDateTime(detail.updatedAt)}</dd></div>
                </dl>
              </>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
