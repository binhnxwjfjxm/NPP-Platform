'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import {
  BusinessSequenceNumber,
  BusinessTableSequenceCell,
  BusinessTableSequenceHeader,
} from '../../components/business-table-sequence';
import {
  formatDate,
  formatDateTime,
  formatQuantity,
  matchTerm,
  normalizeSearch,
  type InventoryBalance,
} from '../../../lib/inventory-types';
import {
  formatSignedExactDecimal,
  subtractExactDecimal,
} from '../../../lib/decimal-display.js';
import {
  inventoryWorkflowErrorMessage,
  officeActorLabel,
} from '../../../lib/inventory-workflow-errors';
import {
  STOCKTAKE_PERMISSION_KEYS,
  STOCKTAKE_STATUS_LABELS,
  type Stocktake,
  type StocktakeLine,
  type StocktakeStatus,
} from '../../../lib/stocktake-types';
import styles from './stocktake-workspace.module.css';
import StocktakePrintDock from './StocktakePrintDock';

type WarehouseOption = { id: string; code: string; name: string };
type ScopeMode = 'all' | 'lot' | 'location';
type ScopeGroup = { key: string; label: string; detail: string; scopeKeys: string[] };

type Props = {
  initialStocktakes: Stocktake[];
  balances: InventoryBalance[];
  warehouses: WarehouseOption[];
  initialPermissionKeys: string[];
  initialError: string | null;
  initialLookupError: string | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; retryable?: boolean; details?: unknown };
};

function exactScopeKey(balance: InventoryBalance): string {
  return `${balance.location_id ?? '<null>'}:${balance.base_variant_id}:${balance.lot_id ?? '<null>'}`;
}

function uniqueScopes(balances: InventoryBalance[]) {
  const seen = new Set<string>();
  return balances.filter((balance) => {
    const key = `${balance.warehouse_id}:${exactScopeKey(balance)}`;
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

function scopeSummary(line: StocktakeLine): string {
  return `${line.baseSku} · Lô ${line.lotCode || 'Không lô'} · Vị trí ${line.locationCode || 'Không vị trí'}`;
}

function stocktakeDifference(line: StocktakeLine): string | null {
  if (line.finalDelta !== null) return line.finalDelta;
  if (line.expectedBaseQuantity === undefined || line.countedBaseQuantity === null) return null;
  return subtractExactDecimal(line.countedBaseQuantity, line.expectedBaseQuantity);
}

function roundStatusLabel(status: string): string {
  return STOCKTAKE_STATUS_LABELS[status as StocktakeStatus] ?? 'Đã cập nhật';
}

function workflowHint(status: StocktakeStatus): string {
  if (status === 'draft' || status === 'recount_required') {
    return 'Nhập số đếm thực tế cho toàn bộ phạm vi. Số hệ thống vẫn được ẩn để giữ nguyên nguyên tắc đếm mù.';
  }
  if (status === 'counted') {
    return 'Đã ghi nhận số đếm. Chọn Gửi duyệt để chuyển phiếu sang người có quyền duyệt.';
  }
  if (status === 'submitted') {
    return 'Đã gửi kiểm kê chờ duyệt. Phiếu đang chờ người có quyền duyệt.';
  }
  if (status === 'approved') {
    return 'Đã duyệt kết quả. Tồn kho chưa thay đổi. Chọn Cập nhật tồn kho để hoàn tất.';
  }
  if (status === 'posted') return 'Hoàn tất. Tồn kho đã được cập nhật theo kết quả kiểm kê đã duyệt.';
  if (status === 'reversed') return 'Phần cập nhật tồn kho của phiếu này đã được hoàn tác.';
  return 'Phiếu đã hủy và không làm thay đổi tồn kho.';
}

export default function StocktakeWorkspace({
  initialStocktakes,
  balances,
  warehouses,
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
  const [scopeMode, setScopeMode] = useState<ScopeMode>('all');
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
  const productNameByVariant = useMemo(
    () => new Map(balances.map((balance) => [balance.base_variant_id, balance.product_name || balance.base_variant_name || balance.base_sku])),
    [balances],
  );
  const availableScopes = useMemo(
    () => scopeBalances.filter((balance) => balance.warehouse_id === warehouseId),
    [scopeBalances, warehouseId],
  );
  const scopeGroups = useMemo<ScopeGroup[]>(() => {
    if (scopeMode === 'all') return [];
    const groups = new Map<string, { items: InventoryBalance[] }>();
    for (const balance of availableScopes) {
      const key = scopeMode === 'lot'
        ? `lot:${balance.base_variant_id}:${balance.lot_id ?? '<null>'}`
        : `location:${balance.location_id ?? '<null>'}`;
      const current = groups.get(key) ?? { items: [] };
      current.items.push(balance);
      groups.set(key, current);
    }
    return [...groups.entries()].map(([key, group]) => {
      const first = group.items[0];
      if (scopeMode === 'lot') {
        return {
          key,
          label: `${first.product_name || first.base_variant_name || first.base_sku} · ${first.base_sku}`,
          detail: `Lô ${first.lot_code || 'Không lô'} · ${group.items.length} vị trí`,
          scopeKeys: group.items.map(exactScopeKey),
        };
      }
      return {
        key,
        label: `Vị trí ${first.location_code || 'Không vị trí'}`,
        detail: `${group.items.length} phạm vi sản phẩm/lô`,
        scopeKeys: group.items.map(exactScopeKey),
      };
    });
  }, [availableScopes, scopeMode]);
  const effectiveSelectedScopes = useMemo(
    () => scopeMode === 'all'
      ? new Set(availableScopes.map(exactScopeKey))
      : selectedScopes,
    [availableScopes, scopeMode, selectedScopes],
  );
  const filtered = useMemo(() => {
    const term = normalizeSearch(search);
    return stocktakes.filter((stocktake) => {
      if (statusFilter && stocktake.status !== statusFilter) return false;
      return !term || matchTerm(
        stocktake.stocktakeNumber,
        stocktake.warehouseCode,
        stocktake.warehouseName,
        STOCKTAKE_STATUS_LABELS[stocktake.status],
      ).includes(term);
    });
  }, [search, statusFilter, stocktakes]);

  const can = (key: string) => permissions.has(key);

  function stableKey(action: string, id: string, revision: string): string {
    const mapKey = `${action}:${id}:${revision}`;
    const existing = idempotencyKeys.current.get(mapKey);
    if (existing) return existing;
    const created = createIdempotencyKey(`stocktake-${action}`);
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
      throw new Error(inventoryWorkflowErrorMessage(payload?.error, 'Thao tác kiểm kê chưa hoàn tất. Hãy làm mới dữ liệu và thử lại.'));
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

  function toggleScopeGroup(group: ScopeGroup, checked: boolean) {
    setSelectedScopes((current) => {
      const next = new Set(current);
      for (const key of group.scopeKeys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  async function createNew() {
    if (!warehouseId || effectiveSelectedScopes.size === 0) {
      setError('Chọn kho và phạm vi cần kiểm kê.');
      return;
    }
    if (effectiveSelectedScopes.size > 500) {
      setError('Phạm vi này có hơn 500 dòng tồn. Hãy chọn theo lô hoặc theo vị trí để chia thành các đợt kiểm kê phù hợp.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const scopes = availableScopes
        .filter((balance) => effectiveSelectedScopes.has(exactScopeKey(balance)))
        .map((balance) => ({
          locationId: balance.location_id,
          baseVariantId: balance.base_variant_id,
          lotId: balance.lot_id,
        }));
      const createFingerprint = `${warehouseId}:${scopeMode}:${[...effectiveSelectedScopes].sort().join('|')}:${note.trim()}`;
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
        setError('Phải nhập số thực đếm cho toàn bộ phạm vi hiện tại.');
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
        count: 'Đã ghi nhận số đếm thực tế. Chọn Gửi duyệt để chuyển phiếu sang người duyệt.',
        submit: 'Đã gửi kiểm kê chờ duyệt. Phiếu đang chờ người có quyền duyệt.',
        recount: 'Đã yêu cầu đếm lại. Lần đếm trước vẫn được lưu trong lịch sử.',
        approve: 'Đã duyệt kết quả kiểm kê. Tồn kho chưa thay đổi. Chọn Cập nhật tồn kho để hoàn tất.',
        post: 'Đã cập nhật tồn kho theo kết quả kiểm kê.',
        cancel: 'Đã hủy đợt kiểm kê. Tồn kho không thay đổi.',
        reverse: 'Đã hoàn tác phần cập nhật tồn kho của phiếu kiểm kê.',
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
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => transition('count')}>Hoàn tất đếm thực tế</button>
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
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => transition('post')}>Cập nhật tồn kho</button>
      ) : null}
      {['draft', 'counted', 'recount_required'].includes(detail.status) && can(STOCKTAKE_PERMISSION_KEYS.cancel) ? (
        <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => transition('cancel')}>Hủy kiểm kê</button>
      ) : null}
      {detail.status === 'posted' && can(STOCKTAKE_PERMISSION_KEYS.reverse) ? (
        <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => transition('reverse')}>Hoàn tác cập nhật tồn</button>
      ) : null}
    </div>
  ) : null;

  const revealSystemQuantity = Boolean(detail?.lines?.some((line) => line.expectedBaseQuantity !== undefined));
  const countingLine = detail?.lines?.length === 1 ? detail.lines[0] : null;

  return (
    <AppShell
      kicker="Tồn kho & lô hàng"
      title="Kiểm kê kho"
      subtitle="Đếm thực tế, gửi duyệt và chỉ cập nhật tồn kho sau khi kết quả đã được duyệt."
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
              <p>Chọn phạm vi theo công việc thực tế. Hệ thống vẫn chuyển lựa chọn thành từng phạm vi tồn chính xác trước khi tạo phiếu.</p>
            </div>
            <label>
              Kho kiểm kê
              <select
                data-testid="stocktake-warehouse"
                value={warehouseId}
                onChange={(event) => {
                  setWarehouseId(event.target.value);
                  setSelectedScopes(new Set());
                }}
              >
                <option value="">Chọn kho</option>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
              </select>
            </label>

            <fieldset className={styles.scopeList}>
              <legend>Cách chọn phạm vi</legend>
              <label className={styles.scopeOption}>
                <input type="radio" name="stocktake-scope-mode" checked={scopeMode === 'all'} onChange={() => { setScopeMode('all'); setSelectedScopes(new Set()); }} />
                <span><strong>Toàn bộ sản phẩm trong kho</strong> · kiểm tất cả sản phẩm, lô và vị trí đang có trong kho</span>
              </label>
              <label className={styles.scopeOption}>
                <input type="radio" name="stocktake-scope-mode" checked={scopeMode === 'lot'} onChange={() => { setScopeMode('lot'); setSelectedScopes(new Set()); }} />
                <span><strong>Theo lô</strong> · chọn một hoặc nhiều lô cần kiểm</span>
              </label>
              <label className={styles.scopeOption}>
                <input type="radio" name="stocktake-scope-mode" checked={scopeMode === 'location'} onChange={() => { setScopeMode('location'); setSelectedScopes(new Set()); }} />
                <span><strong>Theo vị trí</strong> · chọn một hoặc nhiều vị trí cần kiểm</span>
              </label>
            </fieldset>

            {scopeMode === 'all' ? (
              <p>{warehouseId ? `Sẽ kiểm ${availableScopes.length} phạm vi tồn chính xác trong kho đã chọn.` : 'Chọn kho để xem số phạm vi sẽ kiểm.'}</p>
            ) : (
              <div className={styles.scopeList} aria-label={scopeMode === 'lot' ? 'Chọn lô kiểm kê' : 'Chọn vị trí kiểm kê'}>
                {scopeGroups.length ? scopeGroups.map((group) => {
                  const checked = group.scopeKeys.every((key) => selectedScopes.has(key));
                  return (
                    <label className={styles.scopeOption} key={group.key}>
                      <input type="checkbox" checked={checked} onChange={(event) => toggleScopeGroup(group, event.target.checked)} />
                      <span><strong>{group.label}</strong> · {group.detail}</span>
                    </label>
                  );
                }) : <p>Kho chưa có phạm vi phù hợp để chọn.</p>}
              </div>
            )}

            <p>Đã chọn {effectiveSelectedScopes.size} phạm vi tồn chính xác.</p>
            <label>
              Ghi chú
              <textarea value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} />
            </label>
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
              <option value="submitted">Kiểm kê cần duyệt</option>
              {Object.entries(STOCKTAKE_STATUS_LABELS)
                .filter(([value]) => value !== 'submitted')
                .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </section>

        {error ? <div className={styles.alert} role="alert">{error}</div> : null}
        {message ? <div className={styles.statusMessage} role="status">{message}</div> : null}

        <div className={styles.workspace}>
          <section className={styles.listPanel} aria-label="Danh sách kiểm kê">
            {filtered.length ? filtered.map((stocktake, rowIndex) => (
              <button
                type="button"
                key={stocktake.id}
                className={`${styles.listItem} ${selectedId === stocktake.id ? styles.selected : ''}`}
                onClick={() => { setSelectedId(stocktake.id); loadDetail(stocktake.id); }}
              >
                <span className={styles.listHeader}>
                  <span><BusinessSequenceNumber rowIndex={rowIndex} /> <strong>{stocktake.stocktakeNumber}</strong></span>
                  <span className={`${styles.badge} ${statusTone(stocktake.status)}`}>{STOCKTAKE_STATUS_LABELS[stocktake.status]}</span>
                </span>
                <span>{stocktake.warehouseCode} · {stocktake.warehouseName}</span>
                <span>Lần đếm {stocktake.currentRound} · {stocktake.lineCount} phạm vi</span>
                <small>{formatDateTime(stocktake.updatedAt)}</small>
              </button>
            )) : <p className={styles.empty}>Chưa có đợt kiểm kê phù hợp.</p>}
          </section>

          <section className={styles.detailPanel} aria-live="polite">
            {!detail ? <p className={styles.empty}>Chọn một đợt kiểm kê để xem và thao tác.</p> : (
              <>
                <header className={styles.detailHeader}>
                  <div>
                    <p className={styles.eyebrow}>{detail.warehouseCode} · Lần đếm {detail.currentRound}</p>
                    <h2>{detail.stocktakeNumber}</h2>
                    <p>{detail.note || 'Không có ghi chú'}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <StocktakePrintDock stocktake={detail} />
                    <span className={`${styles.badge} ${statusTone(detail.status)}`}>{STOCKTAKE_STATUS_LABELS[detail.status]}</span>
                  </div>
                </header>

                <p>{workflowHint(detail.status)}</p>
                {['draft', 'recount_required'].includes(detail.status) ? (
                  <p>
                    <strong>Đang đếm: </strong>
                    {countingLine ? scopeSummary(countingLine) : `${detail.lines?.length ?? 0} phạm vi trong ${detail.warehouseCode}`}
                  </p>
                ) : null}

                {actionButtons}
                {['draft', 'counted', 'submitted', 'approved', 'posted', 'recount_required'].includes(detail.status) ? (
                  <label className={styles.reasonField}>
                    Lý do khi yêu cầu đếm lại, hủy hoặc hoàn tác
                    <input value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} placeholder="Chỉ nhập khi thao tác yêu cầu lý do" />
                  </label>
                ) : null}

                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <BusinessTableSequenceHeader />
                        <th>Sản phẩm</th>
                        <th>Lô</th>
                        <th>Vị trí</th>
                        <th>Đơn vị</th>
                        {revealSystemQuantity ? <th>Tồn hệ thống</th> : null}
                        <th>Thực đếm</th>
                        {revealSystemQuantity ? <th>Chênh lệch</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.lines ?? []).map((line, rowIndex) => {
                        const difference = stocktakeDifference(line);
                        return (
                          <tr key={line.id}>
                            <BusinessTableSequenceCell rowIndex={rowIndex} />
                            <td>
                              <strong>{productNameByVariant.get(line.baseVariantId) || line.baseSku}</strong>
                              <small>{line.baseSku}</small>
                            </td>
                            <td>
                              <strong>{line.lotCode || 'Không lô'}</strong>
                              {line.expiryDate ? <small>HSD {formatDate(line.expiryDate)}</small> : null}
                            </td>
                            <td>
                              <strong>{line.locationCode || 'Không vị trí'}</strong>
                              {line.locationName ? <small>{line.locationName}</small> : null}
                            </td>
                            <td>{line.sourceUnitCode}</td>
                            {revealSystemQuantity ? (
                              <td>{line.expectedBaseQuantity === undefined ? 'Chưa hiển thị' : formatQuantity(line.expectedBaseQuantity)}</td>
                            ) : null}
                            <td>
                              {['draft', 'recount_required'].includes(detail.status) ? (
                                <input
                                  className={styles.quantityInput}
                                  inputMode="decimal"
                                  aria-label={`Số thực đếm ${scopeSummary(line)}`}
                                  value={counts[line.id] ?? ''}
                                  onChange={(event) => setCounts((current) => ({ ...current, [line.id]: event.target.value }))}
                                />
                              ) : formatQuantity(line.countedBaseQuantity ?? '0')}
                            </td>
                            {revealSystemQuantity ? (
                              <td><strong>{difference === null ? '—' : formatSignedExactDecimal(difference)}</strong></td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <section className={styles.history} aria-labelledby="round-history-title">
                  <h3 id="round-history-title">Lịch sử các lần đếm</h3>
                  <ol>
                    {(detail.rounds ?? []).map((round) => (
                      <li key={round.id}>
                        <strong>Lần đếm {round.roundNumber} · {roundStatusLabel(round.status)}</strong>
                        <span>{officeActorLabel(round.createdBy, 'Người thực hiện')} · {formatDateTime(round.createdAt)}</span>
                        {round.reason ? <span>Lý do: {round.reason}</span> : null}
                      </li>
                    ))}
                  </ol>
                </section>

                <dl className={styles.meta}>
                  <div>
                    <dt>Người gửi</dt>
                    <dd>{officeActorLabel(detail.submittedBy, 'Người gửi')}{detail.submittedAt ? ` · ${formatDateTime(detail.submittedAt)}` : ''}</dd>
                  </div>
                  <div>
                    <dt>Người duyệt</dt>
                    <dd>{officeActorLabel(detail.approvedBy, 'Người duyệt')}{detail.approvedAt ? ` · ${formatDateTime(detail.approvedAt)}` : ''}</dd>
                  </div>
                  <div>
                    <dt>Cập nhật tồn kho</dt>
                    <dd>{detail.postedAt ? `Đã hoàn tất · ${formatDateTime(detail.postedAt)}` : detail.status === 'approved' ? 'Chưa cập nhật' : 'Chưa đến bước cập nhật tồn'}</dd>
                  </div>
                  <div><dt>Cập nhật phiếu</dt><dd>{formatDateTime(detail.updatedAt)}</dd></div>
                </dl>
              </>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
