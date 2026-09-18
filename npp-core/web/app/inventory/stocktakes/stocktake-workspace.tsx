'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useMemo, useRef, useState } from 'react';
import { exactQuantity, exportTable, readTable, requireColumns } from '../../operations/data-exchange/data-exchange-file-utils';
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
type ScopeGroup = {
  key: string;
  label: string;
  detail: string;
  scopeKeys: string[];
  baseVariantId?: string;
  baseSku?: string;
  productName?: string;
  lotId?: string | null;
  lotCode?: string | null;
  expiryDate?: string | null;
  locationId?: string | null;
  locationCode?: string | null;
  locationName?: string | null;
};
type LineFilter = 'all' | 'uncounted' | 'matched' | 'mismatch';

const LINE_PAGE_SIZE = 100;
const SCOPE_PICKER_RESULT_LIMIT = 60;
const COUNT_FILE_HEADERS = [
  'Phiếu kiểm kê',
  'SKU',
  'Tên sản phẩm',
  'ĐVT',
  'Mã lô',
  'Mã vị trí',
  'Số đếm thực tế',
  'Lý do',
  'Ghi chú',
] as const;
const RESULT_HEADERS = [
  'SKU',
  'Tên sản phẩm',
  'ĐVT',
  'Lô',
  'Vị trí',
  'Tồn hệ thống',
  'Tồn thực tế',
  'Chênh lệch',
  'Lý do',
  'Ghi chú',
] as const;

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const guarded = /^[=+@]/.test(raw) || /^-(?!\d+(?:[.,]\d+)?$)/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replaceAll('"', '""')}"`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

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

function normalizedMatchValue(value: unknown): string {
  return String(value ?? '').trim().toLocaleUpperCase('vi-VN');
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
  const [scopeSearch, setScopeSearch] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [lineReasons, setLineReasons] = useState<Record<string, string>>({});
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const [lineFilter, setLineFilter] = useState<LineFilter>('all');
  const [linePage, setLinePage] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || initialLookupError);
  const [message, setMessage] = useState('');
  const idempotencyKeys = useRef(new Map<string, string>());
  const countFileInputRef = useRef<HTMLInputElement | null>(null);
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
          label: first.product_name || first.base_variant_name || first.base_sku,
          detail: `Lô ${first.lot_code || 'Không lô'} · ${group.items.length} vị trí`,
          scopeKeys: group.items.map(exactScopeKey),
          baseVariantId: first.base_variant_id,
          baseSku: first.base_sku,
          productName: first.product_name || first.base_variant_name || first.base_sku,
          lotId: first.lot_id,
          lotCode: first.lot_code,
          expiryDate: first.expiry_date,
        };
      }
      return {
        key,
        label: first.location_code || 'Không vị trí',
        detail: `${first.location_name || 'Vị trí chung'} · ${group.items.length} phạm vi sản phẩm/lô`,
        scopeKeys: group.items.map(exactScopeKey),
        locationId: first.location_id,
        locationCode: first.location_code,
        locationName: first.location_name,
      };
    });
  }, [availableScopes, scopeMode]);
  const selectedScopeGroups = useMemo(
    () => scopeGroups.filter((group) => group.scopeKeys.every((key) => selectedScopes.has(key))),
    [scopeGroups, selectedScopes],
  );
  const filteredScopeGroups = useMemo(() => {
    const term = normalizeSearch(scopeSearch);
    if (!term) return scopeGroups;
    return scopeGroups.filter((group) => matchTerm(
      group.label,
      group.detail,
      group.baseSku,
      group.lotCode,
      group.locationCode,
      group.locationName,
    ).includes(term));
  }, [scopeGroups, scopeSearch]);
  const visibleScopeGroups = useMemo(
    () => filteredScopeGroups.slice(0, SCOPE_PICKER_RESULT_LIMIT),
    [filteredScopeGroups],
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
    setLineReasons(Object.fromEntries((next.lines ?? []).map((line) => [line.id, line.reason ?? ''])));
    setLineNotes(Object.fromEntries((next.lines ?? []).map((line) => [line.id, line.note ?? ''])));
    setLineFilter('all');
    setLinePage(1);
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

  function toggleScopeGroups(groups: ScopeGroup[], checked: boolean) {
    setSelectedScopes((current) => {
      const next = new Set(current);
      for (const group of groups) {
        for (const key of group.scopeKeys) {
          if (checked) next.add(key);
          else next.delete(key);
        }
      }
      return next;
    });
  }

  async function createNew() {
    if (!warehouseId) {
      setError('Chọn kho cần kiểm kê.');
      return;
    }
    if (scopeMode !== 'all' && selectedScopeGroups.length === 0) {
      setError(scopeMode === 'lot' ? 'Chọn ít nhất một lô cần kiểm kê.' : 'Chọn ít nhất một vị trí cần kiểm kê.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const selectionPayload = scopeMode === 'all'
        ? {}
        : scopeMode === 'lot'
          ? {
            lotSelections: selectedScopeGroups.map((group) => ({
              baseVariantId: group.baseVariantId,
              lotId: group.lotId ?? null,
            })),
          }
          : {
            locationIds: selectedScopeGroups.map((group) => group.locationId ?? null),
          };
      const createFingerprint = `${warehouseId}:${scopeMode}:${selectedScopeGroups.map((group) => group.key).sort().join('|')}:${note.trim()}`;
      const createIdempotencyKey = stableKey('create', warehouseId, createFingerprint);
      const response = await fetch('/api/inventory/stocktakes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createIdempotencyKey,
        },
        body: JSON.stringify({
          warehouseId,
          note: note.trim() || null,
          scopeMode,
          ...selectionPayload,
        }),
      });
      const next = await parseResponse<Stocktake>(response);
      idempotencyKeys.current.delete(`create:${warehouseId}:${createFingerprint}`);
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
      payload.counts = lines.map((line) => ({
        lineId: line.id,
        countedBaseQuantity: String(counts[line.id]).trim(),
        reason: String(lineReasons[line.id] ?? '').trim() || null,
        note: String(lineNotes[line.id] ?? '').trim() || null,
      }));
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

  function annotationFingerprint(lines: StocktakeLine[]): string {
    let hash = 2166136261;
    for (const line of lines) {
      const value = `${line.id}\u0000${lineReasons[line.id] ?? ''}\u0000${lineNotes[line.id] ?? ''}\u0001`;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    }
    return (hash >>> 0).toString(16);
  }

  async function saveAnnotations() {
    if (!detail || !['submitted', 'approved'].includes(detail.status)) return;
    const lines = detail.lines ?? [];
    if (!lines.length) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/inventory/stocktakes/${detail.id}/annotate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': stableKey('annotate', detail.id, `${detail.revision}:${annotationFingerprint(lines)}`),
        },
        body: JSON.stringify({
          expectedRevision: detail.revision,
          annotations: lines.map((line) => ({
            lineId: line.id,
            reason: String(lineReasons[line.id] ?? '').trim() || null,
            note: String(lineNotes[line.id] ?? '').trim() || null,
          })),
        }),
      });
      const next = await parseResponse<Stocktake>(response);
      remember(next);
      setMessage('Đã lưu Lý do và Ghi chú cho các dòng kiểm kê.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không lưu được Lý do và Ghi chú');
    } finally {
      setBusy(false);
    }
  }

  async function copyCurrent() {
    if (!detail) return;
    const sourceId = detail.id;
    const sourceRevision = detail.revision;
    const sourceNumber = detail.stocktakeNumber;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const copyIdempotencyKey = stableKey('copy', sourceId, sourceRevision);
      const response = await fetch(`/api/inventory/stocktakes/${sourceId}/copy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': copyIdempotencyKey,
        },
        body: JSON.stringify({ expectedRevision: sourceRevision }),
      });
      const next = await parseResponse<Stocktake>(response);
      idempotencyKeys.current.delete(`copy:${sourceId}:${sourceRevision}`);
      remember(next);
      setMessage(`Đã sao chép phạm vi từ ${sourceNumber}. Phiếu mới dùng tồn hệ thống tại thời điểm vừa tạo.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không sao chép được phiếu kiểm kê');
    } finally {
      setBusy(false);
    }
  }

  async function exportCountFile() {
    if (!detail || !(detail.lines ?? []).length) {
      setError('Phiếu kiểm kê chưa có dòng để xuất.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const fileLines = detail.lines ?? [];
      const rows = fileLines.map((line) => [
        detail.stocktakeNumber,
        line.baseSku,
        productNameByVariant.get(line.baseVariantId) || line.baseSku,
        line.sourceUnitCode,
        line.lotCode || '',
        line.locationCode || '',
        counts[line.id] ?? line.countedBaseQuantity ?? '',
        lineReasons[line.id] ?? line.reason ?? '',
        lineNotes[line.id] ?? line.note ?? '',
      ]);
      await exportTable(
        'kiem-ke-' + detail.stocktakeNumber + '.xlsx',
        'Kiểm kê ' + detail.stocktakeNumber,
        Array.from(COUNT_FILE_HEADERS),
        rows,
        'xlsx',
      );
      setMessage('Đã xuất file của phiếu đang mở. File không có tồn hệ thống để giữ nguyên đếm mù.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không xuất được file phiếu kiểm kê.');
    } finally {
      setBusy(false);
    }
  }

  async function importCountFile(file: File) {
    if (!detail || !['draft', 'recount_required'].includes(detail.status)) {
      setError('Chỉ nhập file khi phiếu đang ở bước đếm thực tế.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const rows = await readTable(file, ['sku', 'actualCount']);
      requireColumns(rows, ['sku', 'actualCount']);
      const lines = detail.lines ?? [];
      const countPatch: Record<string, string> = {};
      const reasonPatch: Record<string, string> = {};
      const notePatch: Record<string, string> = {};
      const usedLineIds = new Set<string>();
      const errors: string[] = [];
      let imported = 0;

      for (const [index, row] of rows.entries()) {
        const actualCount = String(row.actualCount ?? '').trim();
        if (!actualCount) continue;

        const fileStocktake = String(row['Phiếu kiểm kê'] ?? '').trim();
        if (fileStocktake && normalizedMatchValue(fileStocktake) !== normalizedMatchValue(detail.stocktakeNumber)) {
          errors.push('Dòng ' + (index + 2) + ': file thuộc phiếu ' + fileStocktake + ', không phải ' + detail.stocktakeNumber + '.');
          continue;
        }

        const sku = normalizedMatchValue(row.sku);
        if (!sku) {
          errors.push('Dòng ' + (index + 2) + ': thiếu SKU.');
          continue;
        }

        let candidates = lines.filter((line) => (
          normalizedMatchValue(line.baseSku) === sku
          || normalizedMatchValue(line.sourceSku) === sku
        ));

        const lotCode = normalizedMatchValue(row.lotCode);
        const locationCode = normalizedMatchValue(row.locationCode);
        if (lotCode) candidates = candidates.filter((line) => normalizedMatchValue(line.lotCode) === lotCode);
        if (locationCode) candidates = candidates.filter((line) => normalizedMatchValue(line.locationCode) === locationCode);

        if (!lotCode && new Set(candidates.map((line) => normalizedMatchValue(line.lotCode))).size > 1) {
          errors.push('Dòng ' + (index + 2) + ': SKU ' + row.sku + ' có nhiều lô trong phiếu, cần ghi Mã lô.');
          continue;
        }
        if (!locationCode && new Set(candidates.map((line) => normalizedMatchValue(line.locationCode))).size > 1) {
          errors.push('Dòng ' + (index + 2) + ': SKU ' + row.sku + ' có nhiều vị trí trong phiếu, cần ghi Mã vị trí.');
          continue;
        }
        if (candidates.length !== 1) {
          errors.push('Dòng ' + (index + 2) + ': không tìm được đúng một dòng của SKU ' + row.sku + ' trong phiếu.');
          continue;
        }

        const line = candidates[0];
        if (usedLineIds.has(line.id)) {
          errors.push('Dòng ' + (index + 2) + ': SKU ' + row.sku + ' bị trùng phạm vi trong file.');
          continue;
        }

        try {
          countPatch[line.id] = exactQuantity(actualCount, 'Dòng ' + (index + 2) + ' - Số đếm thực tế', 12);
        } catch (caught) {
          errors.push(caught instanceof Error ? caught.message : 'Dòng ' + (index + 2) + ': số đếm không hợp lệ.');
          continue;
        }

        const importedReason = String(row.reason ?? row['Lý do'] ?? '').trim();
        const importedNote = String(row.note ?? row['Ghi chú'] ?? '').trim();
        if (importedReason) reasonPatch[line.id] = importedReason;
        if (importedNote) notePatch[line.id] = importedNote;
        usedLineIds.add(line.id);
        imported += 1;
      }

      if (errors.length) {
        const preview = errors.slice(0, 6).join(' ');
        const remainingErrors = errors.length > 6 ? ' Còn ' + (errors.length - 6) + ' lỗi khác.' : '';
        throw new Error(preview + remainingErrors);
      }
      if (!imported) throw new Error('File chưa có dòng nào được nhập Số đếm thực tế.');

      setCounts((current) => ({ ...current, ...countPatch }));
      if (Object.keys(reasonPatch).length) setLineReasons((current) => ({ ...current, ...reasonPatch }));
      if (Object.keys(notePatch).length) setLineNotes((current) => ({ ...current, ...notePatch }));
      setLineFilter('all');
      setLinePage(1);
      const alreadyCounted = new Set(
        lines.filter((line) => String(counts[line.id] ?? '').trim()).map((line) => line.id),
      );
      for (const lineId of Object.keys(countPatch)) alreadyCounted.add(lineId);
      const remainingLines = Math.max(0, lines.length - alreadyCounted.size);
      setMessage(
        'Đã nhập ' + imported + ' dòng vào phiếu ' + detail.stocktakeNumber
        + '. Còn ' + remainingLines + ' dòng chưa kiểm; vẫn có thể sửa tay.',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không nhập được file kiểm kê.');
    } finally {
      if (countFileInputRef.current) countFileInputRef.current.value = '';
      setBusy(false);
    }
  }

  function resultRows(stocktake: Stocktake): string[][] {
    return (stocktake.lines ?? []).map((line) => {
      const difference = stocktakeDifference(line);
      return [
        line.baseSku,
        productNameByVariant.get(line.baseVariantId) || line.baseSku,
        line.sourceUnitCode,
        line.lotCode || '',
        [line.locationCode, line.locationName].filter(Boolean).join(' · '),
        line.expectedBaseQuantity ?? '',
        line.countedBaseQuantity ?? '',
        difference ?? '',
        line.reason ?? '',
        line.note ?? '',
      ];
    });
  }

  async function exportExcel() {
    if (!detail || !revealSystemQuantity) {
      setError('Chỉ xuất kết quả sau khi số hệ thống được mở để đối chiếu.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/data-exchange/xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetName: `Kiểm kê ${detail.stocktakeNumber}`,
          headers: RESULT_HEADERS,
          rows: resultRows(detail),
        }),
      });
      if (!response.ok) throw new Error('Không tạo được file Excel kết quả kiểm kê.');
      const blob = await response.blob();
      downloadBlob(blob, `kiem-ke-${detail.stocktakeNumber}.xlsx`);
      setMessage('Đã xuất Excel kết quả của phiếu kiểm kê đang mở.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không xuất được Excel kiểm kê');
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!detail || !revealSystemQuantity) {
      setError('Chỉ xuất kết quả sau khi số hệ thống được mở để đối chiếu.');
      return;
    }
    const rows = [Array.from(RESULT_HEADERS), ...resultRows(detail)];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    downloadBlob(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }), `kiem-ke-${detail.stocktakeNumber}.csv`);
    setMessage('Đã xuất CSV kết quả của phiếu kiểm kê đang mở.');
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
      {['submitted', 'approved'].includes(detail.status) && can(STOCKTAKE_PERMISSION_KEYS.count) ? (
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={saveAnnotations}>Lưu Lý do & Ghi chú</button>
      ) : null}
    </div>
  ) : null;

  const revealSystemQuantity = Boolean(detail?.lines?.some((line) => line.expectedBaseQuantity !== undefined));
  const countingLine = detail?.lines?.length === 1 ? detail.lines[0] : null;
  const detailLines = detail?.lines ?? [];
  const isCounting = Boolean(detail && ['draft', 'recount_required'].includes(detail.status));
  const canAnnotateLines = Boolean(detail && ['submitted', 'approved'].includes(detail.status) && can(STOCKTAKE_PERMISSION_KEYS.count));
  const isUncounted = (line: StocktakeLine) => isCounting
    ? !String(counts[line.id] ?? '').trim()
    : line.countedBaseQuantity === null;
  const lineSummary = {
    all: detailLines.length,
    uncounted: detailLines.filter(isUncounted).length,
    matched: detailLines.filter((line) => line.countStatus === 'matched').length,
    mismatch: detailLines.filter((line) => line.countStatus === 'mismatch').length,
  };
  const filteredLines = detailLines.filter((line) => {
    if (lineFilter === 'all') return true;
    if (lineFilter === 'uncounted') return isUncounted(line);
    return line.countStatus === lineFilter;
  });
  const totalLinePages = Math.max(1, Math.ceil(filteredLines.length / LINE_PAGE_SIZE));
  const currentLinePage = Math.min(linePage, totalLinePages);
  const pagedLines = filteredLines.slice(
    (currentLinePage - 1) * LINE_PAGE_SIZE,
    currentLinePage * LINE_PAGE_SIZE,
  );

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
              <p>Chọn phạm vi theo công việc thực tế. Hệ thống lấy trực tiếp dữ liệu tồn hiện tại tại thời điểm tạo phiếu.</p>
            </div>
            <label>
              Kho kiểm kê
              <select
                data-testid="stocktake-warehouse"
                value={warehouseId}
                onChange={(event) => {
                  setWarehouseId(event.target.value);
                  setScopeSearch('');
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
                <input type="radio" name="stocktake-scope-mode" checked={scopeMode === 'all'} onChange={() => { setScopeMode('all'); setScopeSearch(''); setSelectedScopes(new Set()); }} />
                <span><strong>Toàn bộ sản phẩm trong kho</strong> · kiểm tất cả sản phẩm, lô và vị trí đang có trong kho</span>
              </label>
              <label className={styles.scopeOption}>
                <input type="radio" name="stocktake-scope-mode" checked={scopeMode === 'lot'} onChange={() => { setScopeMode('lot'); setScopeSearch(''); setSelectedScopes(new Set()); }} />
                <span><strong>Theo lô</strong> · chọn một hoặc nhiều lô cần kiểm</span>
              </label>
              <label className={styles.scopeOption}>
                <input type="radio" name="stocktake-scope-mode" checked={scopeMode === 'location'} onChange={() => { setScopeMode('location'); setScopeSearch(''); setSelectedScopes(new Set()); }} />
                <span><strong>Theo vị trí</strong> · chọn một hoặc nhiều vị trí cần kiểm</span>
              </label>
            </fieldset>

            {scopeMode === 'all' ? (
              <p>{warehouseId
                ? 'Khi tạo phiếu, hệ thống sẽ lấy trực tiếp toàn bộ phạm vi tồn hợp lệ hiện tại của kho.'
                : 'Chọn kho để bắt đầu kiểm kê.'}</p>
            ) : (
              <div className={styles.scopePicker} aria-label={scopeMode === 'lot' ? 'Chọn lô kiểm kê' : 'Chọn vị trí kiểm kê'}>
                <div className={styles.scopePickerToolbar}>
                  <input
                    className={styles.scopeSearch}
                    value={scopeSearch}
                    onChange={(event) => setScopeSearch(event.target.value)}
                    placeholder={scopeMode === 'lot'
                      ? 'Tìm tên sản phẩm, SKU hoặc mã lô...'
                      : 'Tìm mã hoặc tên vị trí...'}
                    aria-label={scopeMode === 'lot' ? 'Tìm lô kiểm kê' : 'Tìm vị trí kiểm kê'}
                  />
                  <div className={styles.scopePickerActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={!filteredScopeGroups.length}
                      onClick={() => toggleScopeGroups(filteredScopeGroups, true)}
                    >
                      Chọn tất cả kết quả
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={!selectedScopeGroups.length}
                      onClick={() => toggleScopeGroups(filteredScopeGroups, false)}
                    >
                      Bỏ chọn kết quả
                    </button>
                  </div>
                </div>

                <div className={styles.scopePickerMeta}>
                  <strong>Đã chọn {selectedScopeGroups.length} {scopeMode === 'lot' ? 'lô' : 'vị trí'}</strong>
                  <span>{filteredScopeGroups.length} kết quả</span>
                </div>

                {selectedScopeGroups.length ? (
                  <div className={styles.scopeChips} aria-label="Phạm vi đã chọn">
                    {selectedScopeGroups.slice(0, 12).map((group) => (
                      <button
                        type="button"
                        key={group.key}
                        className={styles.scopeChip}
                        onClick={() => toggleScopeGroup(group, false)}
                        title="Bỏ chọn"
                      >
                        {scopeMode === 'lot'
                          ? (group.baseSku || group.label) + ' · ' + (group.lotCode || 'Không lô')
                          : group.label}
                        <span aria-hidden="true">×</span>
                      </button>
                    ))}
                    {selectedScopeGroups.length > 12 ? <span className={styles.scopeChipMore}>+{selectedScopeGroups.length - 12} mục</span> : null}
                  </div>
                ) : null}

                <div className={styles.scopeResults}>
                  {visibleScopeGroups.length ? visibleScopeGroups.map((group) => {
                    const checked = group.scopeKeys.every((key) => selectedScopes.has(key));
                    return (
                      <label className={styles.scopeResult + (checked ? ' ' + styles.scopeResultSelected : '')} key={group.key}>
                        <input type="checkbox" checked={checked} onChange={(event) => toggleScopeGroup(group, event.target.checked)} />
                        <span className={styles.scopeResultMain}>
                          <strong>{group.label}</strong>
                          <small>{scopeMode === 'lot' ? group.baseSku : group.detail}</small>
                        </span>
                        <span className={styles.scopeResultSide}>
                          {scopeMode === 'lot' ? (
                            <>
                              <strong>{group.lotCode || 'Không lô'}</strong>
                              <small>{group.expiryDate ? 'HSD ' + formatDate(group.expiryDate) : group.detail}</small>
                            </>
                          ) : (
                            <>
                              <strong>{group.locationCode || 'Không vị trí'}</strong>
                              <small>{group.locationName || group.detail}</small>
                            </>
                          )}
                        </span>
                      </label>
                    );
                  }) : <p className={styles.empty}>Không có kết quả phù hợp.</p>}
                  {filteredScopeGroups.length > SCOPE_PICKER_RESULT_LIMIT ? (
                    <p className={styles.scopeResultHint}>
                      Đang hiển thị 60 kết quả đầu. Tìm theo tên sản phẩm, SKU hoặc mã lô để thu hẹp nhanh.
                    </p>
                  ) : null}
                </div>
              </div>
            )}

            <p>{scopeMode === 'all'
              ? 'Phạm vi sẽ được chụp lại trực tiếp từ dữ liệu kho khi tạo phiếu.'
              : 'Đã chọn ' + selectedScopeGroups.length + ' ' + (scopeMode === 'lot' ? 'lô' : 'vị trí') + '.'}</p>
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
                <small>Tạo: {officeActorLabel(stocktake.createdBy, 'Người tạo')} · {formatDateTime(stocktake.createdAt)}</small>
                {stocktake.currentCountedAt ? (
                  <small>Kiểm: {officeActorLabel(stocktake.currentCountedBy, 'Người kiểm')} · {formatDateTime(stocktake.currentCountedAt)}</small>
                ) : null}
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
                  <div className={styles.detailTools}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={busy || !(detail.lines ?? []).length}
                      onClick={exportCountFile}
                      title="Xuất file đếm của chính phiếu đang mở; không có tồn hệ thống"
                    >
                      Xuất file phiếu
                    </button>
                    {isCounting && can(STOCKTAKE_PERMISSION_KEYS.count) ? (
                      <>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          disabled={busy}
                          onClick={() => countFileInputRef.current?.click()}
                          title="Nhập nhanh số thực đếm vào chính phiếu đang mở"
                        >
                          Nhập file
                        </button>
                        <input
                          ref={countFileInputRef}
                          className={styles.hiddenFileInput}
                          type="file"
                          accept=".xlsx,.csv"
                          aria-label="Chọn file kết quả kiểm kê"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) void importCountFile(file);
                          }}
                        />
                      </>
                    ) : null}
                    {can(STOCKTAKE_PERMISSION_KEYS.create) ? (
                      <button type="button" className={styles.secondaryButton} disabled={busy} onClick={copyCurrent}>Sao chép phiếu</button>
                    ) : null}
                    {revealSystemQuantity ? (
                      <>
                        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={exportExcel}>
                          Kết quả Excel
                        </button>
                        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={exportCsv}>
                          Kết quả CSV
                        </button>
                      </>
                    ) : null}
                    <StocktakePrintDock stocktake={detail} />
                    <span className={styles.badge + ' ' + statusTone(detail.status)}>{STOCKTAKE_STATUS_LABELS[detail.status]}</span>
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

                <div className={styles.lineFilterBar} aria-label="Lọc dòng kiểm kê">
                  <button
                    type="button"
                    className={lineFilter === 'all' ? styles.lineFilterActive : styles.lineFilterButton}
                    onClick={() => { setLineFilter('all'); setLinePage(1); }}
                  >
                    Tất cả <strong>{lineSummary.all}</strong>
                  </button>
                  <button
                    type="button"
                    className={lineFilter === 'uncounted' ? styles.lineFilterActive : styles.lineFilterButton}
                    onClick={() => { setLineFilter('uncounted'); setLinePage(1); }}
                  >
                    Chưa kiểm <strong>{lineSummary.uncounted}</strong>
                  </button>
                  <button
                    type="button"
                    className={lineFilter === 'matched' ? styles.lineFilterActive : styles.lineFilterButton}
                    disabled={!revealSystemQuantity}
                    onClick={() => { setLineFilter('matched'); setLinePage(1); }}
                  >
                    Khớp <strong>{revealSystemQuantity ? lineSummary.matched : '—'}</strong>
                  </button>
                  <button
                    type="button"
                    className={lineFilter === 'mismatch' ? styles.lineFilterActive : styles.lineFilterButton}
                    disabled={!revealSystemQuantity}
                    onClick={() => { setLineFilter('mismatch'); setLinePage(1); }}
                  >
                    Lệch <strong>{revealSystemQuantity ? lineSummary.mismatch : '—'}</strong>
                  </button>
                </div>

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
                        <th>Lý do</th>
                        <th>Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedLines.map((line) => {
                        const difference = stocktakeDifference(line);
                        return (
                          <tr key={line.id}>
                            <BusinessTableSequenceCell rowIndex={Math.max(0, line.lineNumber - 1)} />
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
                            <td>
                              {isCounting || canAnnotateLines ? (
                                <input
                                  className={styles.lineTextInput}
                                  maxLength={500}
                                  aria-label={`Lý do ${scopeSummary(line)}`}
                                  value={lineReasons[line.id] ?? ''}
                                  onChange={(event) => setLineReasons((current) => ({ ...current, [line.id]: event.target.value }))}
                                  placeholder={line.countStatus === 'mismatch' ? 'Nhập lý do lệch' : 'Không bắt buộc'}
                                />
                              ) : (line.reason || '—')}
                            </td>
                            <td>
                              {isCounting || canAnnotateLines ? (
                                <input
                                  className={styles.lineTextInput}
                                  maxLength={2000}
                                  aria-label={`Ghi chú ${scopeSummary(line)}`}
                                  value={lineNotes[line.id] ?? ''}
                                  onChange={(event) => setLineNotes((current) => ({ ...current, [line.id]: event.target.value }))}
                                  placeholder="Ghi chú"
                                />
                              ) : (line.note || '—')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className={styles.tableFooter}>
                    <span>
                      {filteredLines.length
                        ? `Hiển thị ${(currentLinePage - 1) * LINE_PAGE_SIZE + 1}–${Math.min(currentLinePage * LINE_PAGE_SIZE, filteredLines.length)} / ${filteredLines.length} dòng`
                        : 'Không có dòng phù hợp.'}
                    </span>
                    {filteredLines.length > LINE_PAGE_SIZE ? (
                      <div className={styles.pager}>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          disabled={currentLinePage <= 1}
                          onClick={() => setLinePage((value) => Math.max(1, value - 1))}
                        >
                          Trước
                        </button>
                        <strong>{currentLinePage}/{totalLinePages}</strong>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          disabled={currentLinePage >= totalLinePages}
                          onClick={() => setLinePage((value) => Math.min(totalLinePages, value + 1))}
                        >
                          Sau
                        </button>
                      </div>
                    ) : null}
                  </div>
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
                    <dt>Người tạo</dt>
                    <dd>{officeActorLabel(detail.createdBy, 'Người tạo')} · {formatDateTime(detail.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Người kiểm hiện tại</dt>
                    <dd>{detail.currentCountedAt
                      ? `${officeActorLabel(detail.currentCountedBy, 'Người kiểm')} · ${formatDateTime(detail.currentCountedAt)}`
                      : 'Chưa hoàn tất đếm'}</dd>
                  </div>
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
