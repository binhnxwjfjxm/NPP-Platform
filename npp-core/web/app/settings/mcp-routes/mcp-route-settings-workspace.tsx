'use client';

import { createIdempotencyKey } from '@npp/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from './mcp-route-settings.module.css';

type RouteStatus = 'active' | 'watch' | 'paused';

type RouteItem = Readonly<{
  id: string;
  name: string;
  area: string;
  salesOwner: string;
  plannedCustomers: number;
  visitedCustomers: number;
  orderCount: number;
  lastVisitDate: string;
  status: RouteStatus;
}>;

type RoutesData = Readonly<{ routes?: readonly RouteItem[] }>;
type Envelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;

type Draft = {
  routeName: string;
  area: string;
  weekday: string;
  note: string;
  active: boolean;
};

const EMPTY_DRAFT: Draft = { routeName: '', area: '', weekday: '', note: '', active: true };

const WEEKDAYS = [
  { value: '1', label: 'Thứ 2' },
  { value: '2', label: 'Thứ 3' },
  { value: '3', label: 'Thứ 4' },
  { value: '4', label: 'Thứ 5' },
  { value: '5', label: 'Thứ 6' },
  { value: '6', label: 'Thứ 7' },
  { value: '0', label: 'Chủ nhật' },
] as const;

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { cache: 'no-store', ...init, headers });
  const envelope = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new Error(envelope.error?.message || 'Yêu cầu thiết lập tuyến không thành công.');
  }
  return envelope.data as T;
}

function editDraft(route: RouteItem): Draft {
  return {
    routeName: route.name,
    area: route.area === '-' ? '' : route.area,
    weekday: '',
    note: '',
    active: route.status !== 'paused',
  };
}

function statusLabel(status: RouteStatus) {
  if (status === 'active') return 'Đang sử dụng';
  if (status === 'watch') return 'Cần theo dõi';
  return 'Tạm dừng';
}

export default function McpRouteSettingsWorkspace() {
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [selected, setSelected] = useState<RouteItem | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [mutationKey, setMutationKey] = useState('');
  const [archiveKeys, setArchiveKeys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activeCount = useMemo(
    () => routes.filter((route) => route.status !== 'paused').length,
    [routes],
  );

  const loadRoutes = useCallback(async () => {
    const data = await requestJson<RoutesData>('/api/mcp-routes');
    setRoutes(Array.isArray(data.routes) ? [...data.routes] : []);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadRoutes()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Không tải được danh sách tuyến.'))
      .finally(() => setLoading(false));
  }, [loadRoutes]);

  function startCreate() {
    setMode('create');
    setSelected(null);
    setDraft(EMPTY_DRAFT);
    setMutationKey('');
    setMessage('');
    setError('');
  }

  function startEdit(route: RouteItem) {
    setMode('edit');
    setSelected(route);
    setDraft(editDraft(route));
    setMutationKey('');
    setMessage('');
    setError('');
  }

  function updateDraft<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setMutationKey('');
  }

  async function saveRoute() {
    if (!draft.routeName.trim()) {
      setError('Cần nhập tên tuyến.');
      return;
    }

    const operation = mode === 'create' ? 'company-mcp-route-create' : 'company-mcp-route-update';
    const key = mutationKey || createIdempotencyKey(operation);
    setMutationKey(key);
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const body = mode === 'create'
        ? {
          routeName: draft.routeName.trim(),
          area: draft.area.trim() || null,
          weekday: draft.weekday === '' ? null : Number(draft.weekday),
          note: draft.note.trim() || null,
        }
        : {
          routeName: draft.routeName.trim(),
          area: draft.area.trim() || null,
          active: draft.active,
        };

      if (mode === 'create') {
        await requestJson('/api/mcp-routes', {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
          body: JSON.stringify(body),
        });
        setMessage('Đã tạo tuyến. Tuyến mới sẽ dùng chung cho MCP PWA và Mobile.');
      } else if (selected) {
        await requestJson(`/api/mcp-routes/${encodeURIComponent(selected.id)}`, {
          method: 'PATCH',
          headers: { 'Idempotency-Key': key },
          body: JSON.stringify(body),
        });
        setMessage('Đã cập nhật tuyến.');
      }

      await loadRoutes();
      setMutationKey('');
      setMode('create');
      setSelected(null);
      setDraft(EMPTY_DRAFT);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được tuyến.');
    } finally {
      setSaving(false);
    }
  }

  async function archiveRoute(route: RouteItem) {
    if (!window.confirm(`Ngừng sử dụng tuyến “${route.name}”? Các phiên cũ vẫn được giữ để tra cứu.`)) return;
    const key = archiveKeys[route.id] || createIdempotencyKey('company-mcp-route-archive');
    setArchiveKeys((current) => ({ ...current, [route.id]: key }));
    setSaving(true);
    setError('');
    setMessage('');

    try {
      await requestJson(`/api/mcp-routes/${encodeURIComponent(route.id)}/archive`, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
      });
      setArchiveKeys((current) => {
        const next = { ...current };
        delete next[route.id];
        return next;
      });
      if (selected?.id === route.id) startCreate();
      setMessage('Đã ngừng sử dụng tuyến.');
      await loadRoutes();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Không ngừng được tuyến.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell
      kicker="Cài đặt Công Ty"
      title="Thiết lập tuyến MCP"
      subtitle="Tạo và quản lý tuyến dùng chung cho MCP PWA và Mobile. Nhân viên thị trường chỉ chọn tuyến đã được Công Ty thiết lập."
      actions={<button className={styles.primaryButton} type="button" onClick={startCreate}>Tạo tuyến</button>}
    >
      <div className={styles.workspace} data-testid="mcp-route-settings-workspace">
        <section className={styles.summary} aria-label="Tổng quan tuyến">
          <div><strong>{routes.length}</strong><span>Tổng tuyến</span></div>
          <div><strong>{activeCount}</strong><span>Đang sử dụng</span></div>
          <div><strong>{routes.length - activeCount}</strong><span>Tạm dừng</span></div>
        </section>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.success} role="status">{message}</p> : null}

        <div className={styles.columns}>
          <section className={styles.panel}>
            <header className={styles.panelHeader}>
              <div><p>Danh sách tuyến</p><h2>Tuyến đang thiết lập</h2></div>
              <button type="button" onClick={() => void loadRoutes()} disabled={loading || saving}>Tải lại</button>
            </header>

            <div className={styles.routeList}>
              {routes.map((route) => (
                <article className={selected?.id === route.id ? styles.selectedRoute : styles.routeCard} key={route.id}>
                  <div className={styles.routeTop}>
                    <div><strong>{route.name}</strong><span>{route.area || 'Chưa ghi khu vực'}</span></div>
                    <span className={route.status === 'paused' ? styles.pausedBadge : styles.activeBadge}>{statusLabel(route.status)}</span>
                  </div>
                  <div className={styles.routeMeta}>
                    <span>{route.plannedCustomers} điểm bán</span>
                    <span>{route.visitedCustomers} đã ghé</span>
                    <span>{route.orderCount} đơn</span>
                  </div>
                  <div className={styles.routeActions}>
                    <button type="button" onClick={() => startEdit(route)} disabled={saving}>Sửa tuyến</button>
                    <button type="button" className={styles.dangerButton} onClick={() => void archiveRoute(route)} disabled={saving}>Ngừng sử dụng</button>
                  </div>
                </article>
              ))}
              {!routes.length && !loading ? <p className={styles.empty}>Chưa có tuyến. Bấm “Tạo tuyến” để thiết lập tuyến đầu tiên.</p> : null}
              {loading ? <p className={styles.empty}>Đang tải danh sách tuyến…</p> : null}
            </div>
          </section>

          <section className={styles.panel}>
            <header className={styles.panelHeader}>
              <div><p>{mode === 'create' ? 'Tạo mới' : 'Chỉnh sửa'}</p><h2>{mode === 'create' ? 'Thiết lập tuyến mới' : selected?.name || 'Sửa tuyến'}</h2></div>
            </header>

            <div className={styles.form}>
              <label><span>Tên tuyến</span><input value={draft.routeName} onChange={(event) => updateDraft('routeName', event.target.value)} placeholder="Ví dụ: Tuyến Ninh Kiều 1" /></label>
              <label><span>Khu vực</span><input value={draft.area} onChange={(event) => updateDraft('area', event.target.value)} placeholder="Ví dụ: Ninh Kiều" /></label>

              {mode === 'create' ? (
                <>
                  <label>
                    <span>Ngày đi tuyến cố định</span>
                    <select value={draft.weekday} onChange={(event) => updateDraft('weekday', event.target.value)}>
                      <option value="">Chưa chọn ngày cố định</option>
                      {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                    </select>
                  </label>
                  <label><span>Ghi chú</span><textarea value={draft.note} onChange={(event) => updateDraft('note', event.target.value)} placeholder="Ghi chú nội bộ về tuyến" /></label>
                </>
              ) : (
                <label>
                  <span>Trạng thái</span>
                  <select value={draft.active ? 'active' : 'paused'} onChange={(event) => updateDraft('active', event.target.value === 'active')}>
                    <option value="active">Đang sử dụng</option>
                    <option value="paused">Tạm dừng</option>
                  </select>
                </label>
              )}

              <div className={styles.formHint}>
                {mode === 'create'
                  ? 'Sau khi tạo, tuyến xuất hiện cho MCP PWA và Mobile theo cùng dữ liệu MCP.'
                  : 'Khi sửa tuyến hiện có, hệ thống chỉ thay đổi tên, khu vực và trạng thái; không tự xóa ngày đi tuyến hoặc ghi chú cũ.'}
              </div>

              <div className={styles.formActions}>
                <button className={styles.primaryButton} type="button" onClick={() => void saveRoute()} disabled={saving}>
                  {saving ? 'Đang lưu…' : mode === 'create' ? 'Tạo tuyến' : 'Lưu thay đổi'}
                </button>
                {mode === 'edit' ? <button type="button" onClick={startCreate} disabled={saving}>Hủy sửa</button> : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
