'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from './trip-planning-workspace.module.css';

type Warehouse = { id: string; code: string; name: string };
type LogisticsRoute = { id: string; code: string; name: string; defaultWarehouseId: string | null; isActive: boolean };
type Vehicle = { id: string; code: string; licensePlate: string; vehicleType: string; operationalStatus: string; isActive: boolean };
type Driver = { id: string; code: string; name: string; phone: string | null; isActive: boolean };
type EligibleDeliveryOrder = {
  id: string; number: string | null; salesOrderId: string; warehouseId: string; warehouseCode: string; warehouseName: string;
  customerId: string; customerAddressId: string; customerCode: string; customerName: string; destination: Record<string, unknown>;
  requestedDeliveryDate: string | null; collectionPolicy: string; lineCount: number; totalBaseQuantity: string;
};
type Assignment = { assignmentId: string; deliveryOrderId: string; deliveryOrderNumber: string | null; customerCode: string; customerName: string; requestedDeliveryDate: string | null; collectionPolicy: string };
type TripStop = { id: string; sequence: number; customerId: string; customerAddressId: string; address: Record<string, unknown>; plannedArrivalAt: string | null; assignments: Assignment[] };
type Trip = {
  id: string; number: string; warehouseId: string; warehouseCode: string | null; warehouseName: string | null; deliveryRouteId: string | null;
  routeCode: string | null; routeName: string | null; vehicleId: string | null; vehicleCode: string | null; licensePlate: string | null;
  primaryDriverId: string | null; driverCode: string | null; driverName: string | null; plannedStartAt: string | null;
  status: 'draft' | 'planned' | 'locked'; note: string | null; revision: string; stopCount?: number; assignmentCount?: number; stops?: TripStop[];
};
type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string; details?: unknown } };
type MasterDraft = { code: string; name: string; extra: string };
type TripDraft = { warehouseId: string; deliveryRouteId: string; vehicleId: string; primaryDriverId: string; plannedStartAt: string; note: string };
type FieldErrors = Record<string, string>;
type WorkspaceTab = 'planning' | 'assignment';

const emptyMaster: MasterDraft = { code: '', name: '', extra: '' };
const emptyTrip: TripDraft = { warehouseId: '', deliveryRouteId: '', vehicleId: '', primaryDriverId: '', plannedStartAt: '', note: '' };

class LogisticsRequestError extends Error {
  constructor(public readonly code?: string, message = 'Không thực hiện được thao tác điều phối.', public readonly details?: unknown) {
    super(message);
    this.name = 'LogisticsRequestError';
  }
}

function statusLabel(status: Trip['status']): string { return { draft: 'Nháp', planned: 'Đã lập kế hoạch', locked: 'Đã khóa' }[status]; }
function formatQuantity(value: string): string { return String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1'); }
function businessNumber(value: string | null | undefined, missing: string): string { return value?.trim() || missing; }
function addressLabel(address: Record<string, unknown>): string {
  const candidates = ['addressLine1', 'line1', 'fullAddress', 'address', 'wardName', 'districtName', 'provinceName'];
  const values = candidates.map((key) => address?.[key]).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return [...new Set(values)].join(', ') || 'Địa chỉ giao hàng đã chốt';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) },
  });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new LogisticsRequestError(envelope.error?.code, envelope.error?.message || 'Không thực hiện được thao tác điều phối.', envelope.error?.details);
  }
  return envelope.data;
}

function keyScope(prefix: string, ...parts: Array<string | null | undefined>): string { return [prefix, ...parts.filter(Boolean)].join('|'); }
function hasErrors(errors: FieldErrors): boolean { return Object.keys(errors).length > 0; }
function masterPrefix(resource: 'routes' | 'vehicles' | 'drivers') { return resource === 'routes' ? 'route' : resource === 'vehicles' ? 'vehicle' : 'driver'; }

function validateMaster(resource: 'routes' | 'vehicles' | 'drivers', draft: MasterDraft): FieldErrors {
  const prefix = masterPrefix(resource);
  const errors: FieldErrors = {};
  const code = draft.code.trim();
  const name = draft.name.trim();
  const extra = draft.extra.trim();
  if (!code) errors[`${prefix}.code`] = 'Bắt buộc nhập mã.';
  else if (code.length > 64) errors[`${prefix}.code`] = 'Mã tối đa 64 ký tự.';
  if (!name) errors[`${prefix}.${resource === 'vehicles' ? 'licensePlate' : 'name'}`] = resource === 'vehicles' ? 'Bắt buộc nhập biển số.' : 'Bắt buộc nhập tên.';
  if (resource === 'vehicles' && name.length > 32) errors['vehicle.licensePlate'] = 'Biển số tối đa 32 ký tự.';
  if (resource !== 'vehicles' && name.length > 256) errors[`${prefix}.name`] = 'Tên tối đa 256 ký tự.';
  if (resource === 'vehicles' && !extra) errors['vehicle.vehicleType'] = 'Bắt buộc nhập loại xe.';
  if (resource === 'vehicles' && extra.length > 80) errors['vehicle.vehicleType'] = 'Loại xe tối đa 80 ký tự.';
  if (resource === 'drivers' && extra.length > 32) errors['driver.phone'] = 'Số điện thoại tối đa 32 ký tự.';
  return errors;
}

function serverFieldErrors(code?: string): FieldErrors {
  if (code === 'INVALID_VEHICLE') return { 'vehicle.code': 'Kiểm tra mã xe theo hợp đồng API.', 'vehicle.licensePlate': 'Kiểm tra biển số theo hợp đồng API.', 'vehicle.vehicleType': 'Kiểm tra loại xe theo hợp đồng API.' };
  if (code === 'INVALID_DRIVER_PROFILE') return { 'driver.code': 'Kiểm tra mã tài xế theo hợp đồng API.', 'driver.name': 'Kiểm tra tên tài xế theo hợp đồng API.' };
  if (code === 'INVALID_DELIVERY_TRIP') return { 'trip.warehouseId': 'Chọn kho hợp lệ trong phạm vi được cấp quyền.', 'trip.plannedStartAt': 'Kiểm tra thời gian dự kiến.' };
  return {};
}

export default function TripPlanningWorkspace() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [routes, setRoutes] = useState<LogisticsRoute[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [eligible, setEligible] = useState<EligibleDeliveryOrder[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [routeDraft, setRouteDraft] = useState<MasterDraft>(emptyMaster);
  const [vehicleDraft, setVehicleDraft] = useState<MasterDraft>(emptyMaster);
  const [driverDraft, setDriverDraft] = useState<MasterDraft>(emptyMaster);
  const [tripDraft, setTripDraft] = useState<TripDraft>(emptyTrip);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('planning');
  const [assignmentRouteId, setAssignmentRouteId] = useState('');
  const [assignmentTripId, setAssignmentTripId] = useState('');
  const [selectedDeliveryOrderIds, setSelectedDeliveryOrderIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const operationKeys = useRef(new Map<string, string>());

  const idempotencyKey = useCallback((scope: string) => {
    const existing = operationKeys.current.get(scope);
    if (existing) return existing;
    const next = `web-logistics-${crypto.randomUUID()}`.replace(/[^A-Za-z0-9._-]/g, '_');
    operationKeys.current.set(scope, next);
    return next;
  }, []);
  const clearOperationKey = useCallback((scope: string) => { operationKeys.current.delete(scope); }, []);

  const loadLists = useCallback(async () => {
    const [nextWarehouses, nextRoutes, nextVehicles, nextDrivers, nextEligible, nextTrips] = await Promise.all([
      requestJson<Warehouse[]>('/api/logistics/warehouses'),
      requestJson<LogisticsRoute[]>('/api/logistics/routes?active=true'),
      requestJson<Vehicle[]>('/api/logistics/vehicles?active=true'),
      requestJson<Driver[]>('/api/logistics/drivers?active=true'),
      requestJson<EligibleDeliveryOrder[]>('/api/logistics/eligible-delivery-orders'),
      requestJson<Trip[]>('/api/logistics/trips'),
    ]);
    setWarehouses(nextWarehouses);
    setRoutes(nextRoutes);
    setVehicles(nextVehicles);
    setDrivers(nextDrivers);
    setEligible(nextEligible);
    setTrips(nextTrips);
    setTripDraft((current) => ({
      ...current,
      warehouseId: nextWarehouses.some((warehouse) => warehouse.id === current.warehouseId) ? current.warehouseId : nextWarehouses[0]?.id || '',
      vehicleId: nextVehicles.some((vehicle) => vehicle.id === current.vehicleId) ? current.vehicleId : nextVehicles[0]?.id || '',
      primaryDriverId: nextDrivers.some((driver) => driver.id === current.primaryDriverId) ? current.primaryDriverId : nextDrivers[0]?.id || '',
    }));
  }, []);

  const loadTrip = useCallback(async (tripId: string) => {
    const detail = await requestJson<Trip>(`/api/logistics/trips/${tripId}`);
    setSelectedTrip(detail);
    setTripDraft({ warehouseId: detail.warehouseId, deliveryRouteId: detail.deliveryRouteId || '', vehicleId: detail.vehicleId || '', primaryDriverId: detail.primaryDriverId || '', plannedStartAt: detail.plannedStartAt ? detail.plannedStartAt.slice(0, 16) : '', note: detail.note || '' });
  }, []);

  useEffect(() => {
    setBusy('load');
    loadLists().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Không tải được dữ liệu điều phối.')).finally(() => setBusy(null));
  }, [loadLists]);

  async function runOperation(scope: string, operation: () => Promise<void>) {
    setBusy(scope); setError(''); setMessage(''); setFieldErrors({});
    try { await operation(); clearOperationKey(scope); }
    catch (operationError) {
      if (operationError instanceof LogisticsRequestError) setFieldErrors(serverFieldErrors(operationError.code));
      setError(operationError instanceof Error ? operationError.message : 'Không thực hiện được thao tác.');
    } finally { setBusy(null); }
  }

  async function createMaster(resource: 'routes' | 'vehicles' | 'drivers', draft: MasterDraft) {
    const validation = validateMaster(resource, draft);
    if (hasErrors(validation)) { setFieldErrors(validation); setError('Kiểm tra các trường được đánh dấu trước khi tạo.'); return; }
    const normalized = { code: draft.code.trim(), name: draft.name.trim(), extra: draft.extra.trim() };
    const scope = keyScope(`create-${resource}`, normalized.code, normalized.name, normalized.extra);
    await runOperation(scope, async () => {
      const body = resource === 'routes'
        ? { code: normalized.code, name: normalized.name, description: normalized.extra || null, defaultWarehouseId: tripDraft.warehouseId || null }
        : resource === 'vehicles'
          ? { code: normalized.code, licensePlate: normalized.name, vehicleType: normalized.extra }
          : { code: normalized.code, name: normalized.name, phone: normalized.extra || null };
      await requestJson(`/api/logistics/${resource}`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey(scope) }, body: JSON.stringify(body) });
      if (resource === 'routes') setRouteDraft(emptyMaster);
      if (resource === 'vehicles') setVehicleDraft(emptyMaster);
      if (resource === 'drivers') setDriverDraft(emptyMaster);
      await loadLists(); setMessage('Đã thêm danh mục điều phối.');
    });
  }

  async function createTrip() {
    const validation: FieldErrors = {};
    if (!tripDraft.warehouseId) validation['trip.warehouseId'] = 'Bắt buộc chọn kho xuất phát.';
    else if (!warehouses.some((warehouse) => warehouse.id === tripDraft.warehouseId)) validation['trip.warehouseId'] = 'Kho không còn hoạt động hoặc ngoài phạm vi được cấp quyền.';
    if (tripDraft.deliveryRouteId && !routes.some((route) => route.id === tripDraft.deliveryRouteId)) validation['trip.deliveryRouteId'] = 'Tuyến giao không hợp lệ.';
    if (tripDraft.vehicleId && !vehicles.some((vehicle) => vehicle.id === tripDraft.vehicleId && vehicle.isActive && vehicle.operationalStatus === 'AVAILABLE')) validation['trip.vehicleId'] = 'Xe không còn khả dụng.';
    if (tripDraft.primaryDriverId && !drivers.some((driver) => driver.id === tripDraft.primaryDriverId && driver.isActive)) validation['trip.primaryDriverId'] = 'Tài xế không còn khả dụng.';
    if (tripDraft.plannedStartAt && Number.isNaN(new Date(tripDraft.plannedStartAt).getTime())) validation['trip.plannedStartAt'] = 'Thời gian dự kiến không hợp lệ.';
    if (hasErrors(validation)) { setFieldErrors(validation); setError('Kiểm tra thông tin chuyến trước khi tạo.'); return; }
    const scope = keyScope('create-trip', tripDraft.warehouseId, tripDraft.deliveryRouteId, tripDraft.vehicleId, tripDraft.primaryDriverId, tripDraft.plannedStartAt, tripDraft.note);
    await runOperation(scope, async () => {
      const result = await requestJson<{ trip: Trip } | Trip>('/api/logistics/trips', {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey(scope) }, body: JSON.stringify({
          warehouseId: tripDraft.warehouseId, deliveryRouteId: tripDraft.deliveryRouteId || null, vehicleId: tripDraft.vehicleId || null,
          primaryDriverId: tripDraft.primaryDriverId || null, plannedStartAt: tripDraft.plannedStartAt ? new Date(tripDraft.plannedStartAt).toISOString() : null,
          note: tripDraft.note.trim() || null,
        }),
      });
      const trip = 'trip' in result ? result.trip : result;
      await loadLists(); await loadTrip(trip.id); setMessage(`Đã tạo chuyến ${trip.number}.`);
    });
  }

  async function updateTrip() {
    if (!selectedTrip) return;
    const scope = keyScope('update-trip', selectedTrip.id, selectedTrip.revision, tripDraft.vehicleId, tripDraft.primaryDriverId, tripDraft.deliveryRouteId, tripDraft.plannedStartAt, tripDraft.note);
    await runOperation(scope, async () => {
      const result = await requestJson<{ trip: Trip }>(`/api/logistics/trips/${selectedTrip.id}`, {
        method: 'PUT', headers: { 'Idempotency-Key': idempotencyKey(scope) }, body: JSON.stringify({
          deliveryRouteId: tripDraft.deliveryRouteId || null, vehicleId: tripDraft.vehicleId || null, primaryDriverId: tripDraft.primaryDriverId || null,
          plannedStartAt: tripDraft.plannedStartAt ? new Date(tripDraft.plannedStartAt).toISOString() : null, note: tripDraft.note.trim() || null,
        }),
      });
      setSelectedTrip(result.trip); await loadLists(); setMessage('Đã cập nhật kế hoạch chuyến.');
    });
  }

  async function tripAction(action: 'unassign' | 'reorder' | 'plan' | 'reopen' | 'lock', body: unknown, discriminator: string) {
    if (!selectedTrip) return;
    const scope = keyScope(action, selectedTrip.id, selectedTrip.revision, discriminator);
    await runOperation(scope, async () => {
      const result = await requestJson<{ trip: Trip }>(`/api/logistics/trips/${selectedTrip.id}/${action}`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey(scope) }, body: JSON.stringify(body) });
      setSelectedTrip(result.trip); await loadLists();
      setMessage({ unassign: 'Đã bỏ phiếu giao khỏi chuyến.', reorder: 'Đã cập nhật thứ tự điểm giao.', plan: 'Chuyến đã chuyển sang trạng thái lập kế hoạch.', reopen: 'Chuyến đã mở lại để chỉnh sửa.', lock: 'Kế hoạch chuyến đã khóa.' }[action]);
    });
  }

  async function assignSelectedOrders() {
    const targetTrip = trips.find((trip) => trip.id === assignmentTripId);
    if (!targetTrip || selectedDeliveryOrderIds.length === 0 || targetTrip.status === 'locked') return;
    const deliveryOrderIds = [...selectedDeliveryOrderIds].sort();
    const scope = keyScope('assign-batch', targetTrip.id, ...deliveryOrderIds);
    await runOperation(scope, async () => {
      const result = await requestJson<{ trip: Trip; assignmentCount?: number }>(`/api/logistics/trips/${targetTrip.id}/assign`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey(scope) },
        body: JSON.stringify({ deliveryOrderIds }),
      });
      setSelectedDeliveryOrderIds([]);
      await loadLists();
      await loadTrip(targetTrip.id);
      setMessage(`Đã gán ${result.assignmentCount ?? deliveryOrderIds.length} phiếu giao vào chuyến ${result.trip.number}.`);
    });
  }

  async function moveStop(stopId: string, direction: -1 | 1) {
    if (!selectedTrip?.stops) return;
    const stopIds = selectedTrip.stops.map((stop) => stop.id); const index = stopIds.indexOf(stopId); const target = index + direction;
    if (index < 0 || target < 0 || target >= stopIds.length) return;
    [stopIds[index], stopIds[target]] = [stopIds[target], stopIds[index]];
    await tripAction('reorder', { stopIds }, stopIds.join('-'));
  }

  const editable = selectedTrip !== null && selectedTrip.status !== 'locked';
  const canPlan = selectedTrip?.status === 'draft' && Boolean(selectedTrip.stops?.length);
  const canLock = selectedTrip?.status === 'planned';
  const routeTrips = trips.filter((trip) => trip.deliveryRouteId === assignmentRouteId && trip.status !== 'locked');
  const assignmentTrip = trips.find((trip) => trip.id === assignmentTripId) ?? null;
  const selectedEligible = eligible.filter((order) => order.warehouseId === assignmentTrip?.warehouseId);

  function changeAssignmentRoute(routeId: string) {
    setAssignmentRouteId(routeId);
    setAssignmentTripId('');
    setSelectedDeliveryOrderIds([]);
  }

  function changeAssignmentTrip(tripId: string) {
    setAssignmentTripId(tripId);
    setSelectedDeliveryOrderIds([]);
    if (tripId) void runOperation(`load-assignment-${tripId}`, () => loadTrip(tripId));
  }

  function toggleDeliveryOrder(order: EligibleDeliveryOrder) {
    if (!order.number) return;
    setSelectedDeliveryOrderIds((current) => current.includes(order.id)
      ? current.filter((id) => id !== order.id)
      : [...current, order.id]);
  }

  return (
    <AppShell kicker="Giao nhận" title="Điều phối giao hàng" subtitle="Lập chuyến và gán nhiều phiếu giao theo tuyến; chưa xuất kho hay ghi kết quả giao.">
      <div className={styles.workspace} data-testid="trip-planning-workspace">
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.message} role="status">{message}</p> : null}

        <div className={styles.actions} role="tablist" aria-label="Điều phối chuyến">
          <button type="button" role="tab" aria-selected={activeTab === 'planning'} className={activeTab === 'planning' ? styles.primaryButton : styles.secondaryButton} onClick={() => setActiveTab('planning')} data-testid="planning-tab">Lập chuyến</button>
          <button type="button" role="tab" aria-selected={activeTab === 'assignment'} className={activeTab === 'assignment' ? styles.primaryButton : styles.secondaryButton} onClick={() => setActiveTab('assignment')} data-testid="assignment-tab">Gán chuyến</button>
        </div>

        {activeTab === 'planning' ? <>
          <section className={styles.section} aria-labelledby="logistics-master-heading">
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Danh mục điều phối</p><h2 id="logistics-master-heading">Tuyến, xe và tài xế</h2></div></div>
            <div className={styles.masterGrid}>
              <MasterForm resource="routes" title="Tuyến giao" draft={routeDraft} labels={['Mã tuyến', 'Tên tuyến', 'Mô tả']} onChange={setRouteDraft} onSubmit={() => createMaster('routes', routeDraft)} disabled={busy !== null} testId="create-route" fieldErrors={fieldErrors} />
              <MasterForm resource="vehicles" title="Phương tiện" draft={vehicleDraft} labels={['Mã xe', 'Biển số', 'Loại xe']} onChange={setVehicleDraft} onSubmit={() => createMaster('vehicles', vehicleDraft)} disabled={busy !== null} testId="create-vehicle" fieldErrors={fieldErrors} />
              <MasterForm resource="drivers" title="Tài xế" draft={driverDraft} labels={['Mã tài xế', 'Tên tài xế', 'Số điện thoại']} onChange={setDriverDraft} onSubmit={() => createMaster('drivers', driverDraft)} disabled={busy !== null} testId="create-driver" fieldErrors={fieldErrors} />
            </div>
          </section>

          <section className={styles.section} aria-labelledby="create-trip-heading">
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Kế hoạch chuyến</p><h2 id="create-trip-heading">Tạo chuyến giao</h2></div>
              <button type="button" className={styles.primaryButton} onClick={createTrip} disabled={busy !== null || !tripDraft.warehouseId} data-testid="create-trip-button">Tạo chuyến</button>
            </div>
            <TripFields draft={tripDraft} setDraft={setTripDraft} warehouses={warehouses} routes={routes} vehicles={vehicles} drivers={drivers} disabled={busy !== null} fieldErrors={fieldErrors} />
          </section>

          <div className={styles.columns}>
            <section className={styles.section} aria-labelledby="trip-list-heading">
              <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Danh sách</p><h2 id="trip-list-heading">Các chuyến giao</h2></div>
                <button type="button" className={styles.secondaryButton} onClick={() => loadLists()} disabled={busy !== null}>Tải lại</button>
              </div>
              <div className={styles.list} data-testid="trip-list">
                {trips.map((trip) => <button type="button" key={trip.id} className={`${styles.listItem} ${selectedTrip?.id === trip.id ? styles.selected : ''}`} onClick={() => runOperation(`load-${trip.id}`, () => loadTrip(trip.id))}><strong>{trip.number}</strong><span>{trip.routeCode || 'Chưa chọn tuyến'} · {trip.warehouseCode || 'Kho'}</span><small>{statusLabel(trip.status)} · {trip.stopCount || 0} điểm · {trip.assignmentCount || 0} phiếu</small></button>)}
                {!trips.length && busy !== 'load' ? <p className={styles.empty}>Chưa có chuyến giao.</p> : null}
              </div>
            </section>

            <section className={styles.section} aria-labelledby="trip-detail-heading">
              <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Chi tiết</p><h2 id="trip-detail-heading">{selectedTrip ? selectedTrip.number : 'Chọn một chuyến'}</h2></div>{selectedTrip ? <span className={styles.status} data-status={selectedTrip.status}>{statusLabel(selectedTrip.status)}</span> : null}</div>
              {selectedTrip ? <>
                <TripFields draft={tripDraft} setDraft={setTripDraft} warehouses={warehouses} routes={routes} vehicles={vehicles} drivers={drivers} disabled={busy !== null || !editable} lockWarehouse fieldErrors={fieldErrors} />
                <div className={styles.actions}>
                  {editable ? <button type="button" className={styles.secondaryButton} onClick={updateTrip} disabled={busy !== null}>Lưu kế hoạch</button> : null}
                  {canPlan ? <button type="button" className={styles.primaryButton} onClick={() => tripAction('plan', {}, 'plan')} disabled={busy !== null} data-testid="plan-trip-button">Chuyển sang đã lập kế hoạch</button> : null}
                  {selectedTrip.status === 'planned' ? <button type="button" className={styles.secondaryButton} onClick={() => tripAction('reopen', { reason: 'Điều chỉnh kế hoạch trước khi khóa' }, 'reopen')} disabled={busy !== null}>Mở lại chỉnh sửa</button> : null}
                  {canLock ? <button type="button" className={styles.dangerButton} onClick={() => tripAction('lock', {}, 'lock')} disabled={busy !== null} data-testid="lock-trip-button">Khóa kế hoạch</button> : null}
                </div>
                <div className={styles.stopList} data-testid="trip-stop-list">
                  {(selectedTrip.stops || []).map((stop, index) => <article className={styles.stopCard} key={stop.id}><header><div><strong>Điểm {stop.sequence}</strong><p>{addressLabel(stop.address)}</p></div>{editable ? <div className={styles.moveButtons}><button type="button" onClick={() => moveStop(stop.id, -1)} disabled={busy !== null || index === 0} aria-label="Đưa điểm giao lên">↑</button><button type="button" onClick={() => moveStop(stop.id, 1)} disabled={busy !== null || index === (selectedTrip.stops?.length || 0) - 1} aria-label="Đưa điểm giao xuống">↓</button></div> : null}</header>
                    {stop.assignments.map((assignment) => <div className={styles.assignment} key={assignment.assignmentId}><span><strong>{businessNumber(assignment.deliveryOrderNumber, 'Thiếu mã phiếu giao')}</strong><small>{assignment.customerCode} · {assignment.customerName}</small></span>{editable ? <button type="button" className={styles.textButton} onClick={() => tripAction('unassign', { deliveryOrderId: assignment.deliveryOrderId, reason: 'Điều chỉnh kế hoạch chuyến' }, assignment.deliveryOrderId)} disabled={busy !== null}>Bỏ khỏi chuyến</button> : null}</div>)}
                  </article>)}
                  {!selectedTrip.stops?.length ? <p className={styles.empty}>Chưa có điểm giao.</p> : null}
                </div>
                {selectedTrip.status === 'locked' ? <p className={styles.lockNotice} data-testid="locked-read-only">Kế hoạch đã khóa. Xe, tài xế, điểm dừng và phiếu giao chỉ được đọc.</p> : null}
              </> : <p className={styles.empty}>Chọn chuyến bên trái để lập kế hoạch.</p>}
            </section>
          </div>
        </> : <section className={styles.section} aria-labelledby="assign-trip-heading" data-testid="assignment-workspace">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Gán chuyến</p><h2 id="assign-trip-heading">Tuyến → Chuyến → Phiếu giao</h2></div></div>
          <div className={styles.formGrid}>
            <label>Tuyến giao
              <select value={assignmentRouteId} onChange={(event) => changeAssignmentRoute(event.target.value)} disabled={busy !== null} data-testid="assignment-route">
                <option value="">Chọn tuyến</option>
                {routes.map((route) => <option key={route.id} value={route.id}>{route.code} · {route.name}</option>)}
              </select>
            </label>
            <label>Chuyến giao
              <select value={assignmentTripId} onChange={(event) => changeAssignmentTrip(event.target.value)} disabled={busy !== null || !assignmentRouteId} data-testid="assignment-trip">
                <option value="">Chọn chuyến</option>
                {routeTrips.map((trip) => <option key={trip.id} value={trip.id}>{trip.number} · {statusLabel(trip.status)}</option>)}
              </select>
            </label>
          </div>

          {assignmentTrip ? <div className={styles.readyQueue}>
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>{assignmentTrip.number}</p><h3>Phiếu sẵn sàng cùng kho</h3></div><button type="button" className={styles.primaryButton} onClick={assignSelectedOrders} disabled={busy !== null || selectedDeliveryOrderIds.length === 0} data-testid="assign-selected-orders">Gán {selectedDeliveryOrderIds.length} đơn</button></div>
            {selectedEligible.map((order) => <label className={styles.readyItem} key={order.id}>
              <span><strong>{businessNumber(order.number, 'Thiếu mã phiếu giao')}</strong><small>{order.customerCode} · {order.customerName}</small><small>{formatQuantity(order.totalBaseQuantity)} · {order.lineCount} dòng</small></span>
              <input type="checkbox" checked={selectedDeliveryOrderIds.includes(order.id)} onChange={() => toggleDeliveryOrder(order)} disabled={busy !== null || !order.number} aria-label={order.number ? `Chọn ${order.number}` : 'Phiếu giao thiếu mã canonical'} />
            </label>)}
            {!selectedEligible.length ? <p className={styles.empty}>Không còn phiếu giao đủ điều kiện trong kho của chuyến này.</p> : null}
          </div> : <p className={styles.empty}>Chọn tuyến trước, sau đó chọn chuyến để tích nhiều phiếu giao.</p>}
        </section>}
      </div>
    </AppShell>
  );
}

function FieldError({ message }: { message?: string }) { return message ? <small role="alert">{message}</small> : null; }

function MasterForm({ resource, title, draft, labels, onChange, onSubmit, disabled, testId, fieldErrors }: {
  resource: 'routes' | 'vehicles' | 'drivers'; title: string; draft: MasterDraft; labels: [string, string, string]; onChange: (value: MasterDraft) => void; onSubmit: () => void; disabled: boolean; testId: string; fieldErrors: FieldErrors;
}) {
  const prefix = masterPrefix(resource); const secondKey = resource === 'vehicles' ? 'licensePlate' : 'name'; const thirdKey = resource === 'vehicles' ? 'vehicleType' : resource === 'drivers' ? 'phone' : 'description';
  const needsExtra = resource === 'vehicles';
  return <div className={styles.masterCard}><h3>{title}</h3>
    <label>{labels[0]}<input value={draft.code} maxLength={64} onChange={(event) => onChange({ ...draft, code: event.target.value })} disabled={disabled} aria-invalid={Boolean(fieldErrors[`${prefix}.code`])} /><FieldError message={fieldErrors[`${prefix}.code`]} /></label>
    <label>{labels[1]}<input value={draft.name} maxLength={resource === 'vehicles' ? 32 : 256} onChange={(event) => onChange({ ...draft, name: event.target.value })} disabled={disabled} aria-invalid={Boolean(fieldErrors[`${prefix}.${secondKey}`])} /><FieldError message={fieldErrors[`${prefix}.${secondKey}`]} /></label>
    <label>{labels[2]}<input value={draft.extra} maxLength={resource === 'vehicles' ? 80 : resource === 'drivers' ? 32 : undefined} onChange={(event) => onChange({ ...draft, extra: event.target.value })} disabled={disabled} aria-invalid={Boolean(fieldErrors[`${prefix}.${thirdKey}`])} /><FieldError message={fieldErrors[`${prefix}.${thirdKey}`]} /></label>
    <button type="button" className={styles.secondaryButton} onClick={onSubmit} disabled={disabled || !draft.code.trim() || !draft.name.trim() || (needsExtra && !draft.extra.trim())} data-testid={testId}>Thêm {title.toLowerCase()}</button>
  </div>;
}

function TripFields({ draft, setDraft, warehouses, routes, vehicles, drivers, disabled, lockWarehouse = false, fieldErrors }: {
  draft: TripDraft; setDraft: (value: TripDraft) => void; warehouses: Warehouse[]; routes: LogisticsRoute[]; vehicles: Vehicle[]; drivers: Driver[]; disabled: boolean; lockWarehouse?: boolean; fieldErrors: FieldErrors;
}) {
  return <div className={styles.formGrid}>
    <label>Kho xuất phát<select value={draft.warehouseId} onChange={(event) => setDraft({ ...draft, warehouseId: event.target.value })} disabled={disabled || lockWarehouse} data-testid="trip-warehouse" aria-invalid={Boolean(fieldErrors['trip.warehouseId'])}><option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select><FieldError message={fieldErrors['trip.warehouseId']} /></label>
    <label>Tuyến giao<select value={draft.deliveryRouteId} onChange={(event) => setDraft({ ...draft, deliveryRouteId: event.target.value })} disabled={disabled} aria-invalid={Boolean(fieldErrors['trip.deliveryRouteId'])}><option value="">Không dùng tuyến mẫu</option>{routes.map((route) => <option key={route.id} value={route.id}>{route.code} · {route.name}</option>)}</select><FieldError message={fieldErrors['trip.deliveryRouteId']} /></label>
    <label>Phương tiện<select value={draft.vehicleId} onChange={(event) => setDraft({ ...draft, vehicleId: event.target.value })} disabled={disabled} data-testid="trip-vehicle" aria-invalid={Boolean(fieldErrors['trip.vehicleId'])}><option value="">Chọn xe</option>{vehicles.filter((vehicle) => vehicle.isActive && vehicle.operationalStatus === 'AVAILABLE').map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.code} · {vehicle.licensePlate}</option>)}</select><FieldError message={fieldErrors['trip.vehicleId']} /></label>
    <label>Tài xế chính<select value={draft.primaryDriverId} onChange={(event) => setDraft({ ...draft, primaryDriverId: event.target.value })} disabled={disabled} data-testid="trip-driver" aria-invalid={Boolean(fieldErrors['trip.driverId'])}><option value="">Chọn tài xế</option>{drivers.filter((driver) => driver.isActive).map((driver) => <option key={driver.id} value={driver.id}>{driver.code} · {driver.name}</option>)}</select><FieldError message={fieldErrors['trip.primaryDriverId']} /></label>
    <label>Giờ dự kiến<input type="datetime-local" value={draft.plannedStartAt} onChange={(event) => setDraft({ ...draft, plannedStartAt: event.target.value })} disabled={disabled} aria-invalid={Boolean(fieldErrors['trip.plannedStartAt'])} /><FieldError message={fieldErrors['trip.plannedStartAt']} /></label>
    <label className={styles.noteField}>Ghi chú<input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} disabled={disabled} /></label>
  </div>;
}
