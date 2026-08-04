'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import styles from './trip-planning-workspace.module.css';

type LogisticsRoute = {
  id: string;
  code: string;
  name: string;
  defaultWarehouseId: string | null;
  isActive: boolean;
};

type Vehicle = {
  id: string;
  code: string;
  licensePlate: string;
  vehicleType: string;
  operationalStatus: string;
  isActive: boolean;
};

type Driver = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  isActive: boolean;
};

type EligibleDeliveryOrder = {
  id: string;
  number: string | null;
  salesOrderId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  customerId: string;
  customerAddressId: string;
  customerCode: string;
  customerName: string;
  destination: Record<string, unknown>;
  requestedDeliveryDate: string | null;
  collectionPolicy: string;
  lineCount: number;
  totalBaseQuantity: string;
};

type Assignment = {
  assignmentId: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  customerCode: string;
  customerName: string;
  requestedDeliveryDate: string | null;
  collectionPolicy: string;
};

type TripStop = {
  id: string;
  sequence: number;
  customerId: string;
  customerAddressId: string;
  address: Record<string, unknown>;
  plannedArrivalAt: string | null;
  assignments: Assignment[];
};

type Trip = {
  id: string;
  number: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  deliveryRouteId: string | null;
  routeCode: string | null;
  routeName: string | null;
  vehicleId: string | null;
  vehicleCode: string | null;
  licensePlate: string | null;
  primaryDriverId: string | null;
  driverCode: string | null;
  driverName: string | null;
  plannedStartAt: string | null;
  status: 'draft' | 'planned' | 'locked';
  note: string | null;
  revision: string;
  stopCount?: number;
  assignmentCount?: number;
  stops?: TripStop[];
};

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };

type MasterDraft = { code: string; name: string; extra: string };

type TripDraft = {
  warehouseId: string;
  deliveryRouteId: string;
  vehicleId: string;
  primaryDriverId: string;
  plannedStartAt: string;
  note: string;
};

const emptyMaster: MasterDraft = { code: '', name: '', extra: '' };
const emptyTrip: TripDraft = {
  warehouseId: '',
  deliveryRouteId: '',
  vehicleId: '',
  primaryDriverId: '',
  plannedStartAt: '',
  note: '',
};

function statusLabel(status: Trip['status']): string {
  return { draft: 'Nháp', planned: 'Đã lập kế hoạch', locked: 'Đã khóa' }[status];
}

function formatQuantity(value: string): string {
  return String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function addressLabel(address: Record<string, unknown>): string {
  const candidates = ['addressLine1', 'line1', 'fullAddress', 'address', 'wardName', 'districtName', 'provinceName'];
  const values = candidates
    .map((key) => address?.[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return [...new Set(values)].join(', ') || 'Địa chỉ giao hàng đã chốt';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new Error(envelope.error?.message || 'Không thực hiện được thao tác điều phối.');
  }
  return envelope.data;
}

function keyScope(prefix: string, ...parts: Array<string | null | undefined>): string {
  return `${prefix}:${parts.filter(Boolean).join(':')}`;
}

export default function TripPlanningWorkspace() {
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const operationKeys = useRef(new Map<string, string>());

  const idempotencyKey = useCallback((scope: string) => {
    const existing = operationKeys.current.get(scope);
    if (existing) return existing;
    const next = `web-logistics-${scope}-${crypto.randomUUID()}`
      .replace(/[^A-Za-z0-9._:-]/g, '_')
      .slice(0, 128);
    operationKeys.current.set(scope, next);
    return next;
  }, []);

  const clearOperationKey = useCallback((scope: string) => {
    operationKeys.current.delete(scope);
  }, []);

  const warehouses = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const order of eligible) {
      map.set(order.warehouseId, {
        id: order.warehouseId,
        code: order.warehouseCode,
        name: order.warehouseName,
      });
    }
    for (const trip of trips) {
      map.set(trip.warehouseId, {
        id: trip.warehouseId,
        code: trip.warehouseCode || trip.warehouseId.slice(0, 8),
        name: trip.warehouseName || 'Kho được cấp quyền',
      });
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [eligible, trips]);

  const loadLists = useCallback(async () => {
    const [nextRoutes, nextVehicles, nextDrivers, nextEligible, nextTrips] = await Promise.all([
      requestJson<LogisticsRoute[]>('/api/logistics/routes?active=true'),
      requestJson<Vehicle[]>('/api/logistics/vehicles?active=true'),
      requestJson<Driver[]>('/api/logistics/drivers?active=true'),
      requestJson<EligibleDeliveryOrder[]>('/api/logistics/eligible-delivery-orders'),
      requestJson<Trip[]>('/api/logistics/trips'),
    ]);
    setRoutes(nextRoutes);
    setVehicles(nextVehicles);
    setDrivers(nextDrivers);
    setEligible(nextEligible);
    setTrips(nextTrips);
    setTripDraft((current) => ({
      ...current,
      warehouseId: current.warehouseId || nextEligible[0]?.warehouseId || nextTrips[0]?.warehouseId || '',
      vehicleId: current.vehicleId || nextVehicles[0]?.id || '',
      primaryDriverId: current.primaryDriverId || nextDrivers[0]?.id || '',
    }));
  }, []);

  const loadTrip = useCallback(async (tripId: string) => {
    const detail = await requestJson<Trip>(`/api/logistics/trips/${tripId}`);
    setSelectedTrip(detail);
    setTripDraft({
      warehouseId: detail.warehouseId,
      deliveryRouteId: detail.deliveryRouteId || '',
      vehicleId: detail.vehicleId || '',
      primaryDriverId: detail.primaryDriverId || '',
      plannedStartAt: detail.plannedStartAt ? detail.plannedStartAt.slice(0, 16) : '',
      note: detail.note || '',
    });
  }, []);

  useEffect(() => {
    setBusy('load');
    loadLists()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Không tải được dữ liệu điều phối.'))
      .finally(() => setBusy(null));
  }, [loadLists]);

  async function runOperation(scope: string, operation: () => Promise<void>) {
    setBusy(scope);
    setError('');
    setMessage('');
    try {
      await operation();
      clearOperationKey(scope);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Không thực hiện được thao tác.');
    } finally {
      setBusy(null);
    }
  }

  async function createMaster(resource: 'routes' | 'vehicles' | 'drivers', draft: MasterDraft) {
    const scope = keyScope(`create-${resource}`, draft.code, draft.name, draft.extra);
    await runOperation(scope, async () => {
      const body = resource === 'routes'
        ? { code: draft.code, name: draft.name, description: draft.extra || null, defaultWarehouseId: tripDraft.warehouseId || null }
        : resource === 'vehicles'
          ? { code: draft.code, licensePlate: draft.name, vehicleType: draft.extra || 'Xe giao hàng' }
          : { code: draft.code, name: draft.name, phone: draft.extra || null };
      await requestJson(`/api/logistics/${resource}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey(scope) },
        body: JSON.stringify(body),
      });
      if (resource === 'routes') setRouteDraft(emptyMaster);
      if (resource === 'vehicles') setVehicleDraft(emptyMaster);
      if (resource === 'drivers') setDriverDraft(emptyMaster);
      await loadLists();
      setMessage('Đã thêm danh mục điều phối.');
    });
  }

  async function createTrip() {
    const scope = keyScope('create-trip', tripDraft.warehouseId, tripDraft.deliveryRouteId, tripDraft.vehicleId, tripDraft.primaryDriverId, tripDraft.plannedStartAt, tripDraft.note);
    await runOperation(scope, async () => {
      const result = await requestJson<{ trip: Trip } | Trip>('/api/logistics/trips', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey(scope) },
        body: JSON.stringify({
          warehouseId: tripDraft.warehouseId,
          deliveryRouteId: tripDraft.deliveryRouteId || null,
          vehicleId: tripDraft.vehicleId || null,
          primaryDriverId: tripDraft.primaryDriverId || null,
          plannedStartAt: tripDraft.plannedStartAt ? new Date(tripDraft.plannedStartAt).toISOString() : null,
          note: tripDraft.note || null,
        }),
      });
      const trip = 'trip' in result ? result.trip : result;
      await loadLists();
      await loadTrip(trip.id);
      setMessage(`Đã tạo chuyến ${trip.number}.`);
    });
  }

  async function updateTrip() {
    if (!selectedTrip) return;
    const scope = keyScope('update-trip', selectedTrip.id, selectedTrip.revision, tripDraft.vehicleId, tripDraft.primaryDriverId, tripDraft.deliveryRouteId, tripDraft.plannedStartAt, tripDraft.note);
    await runOperation(scope, async () => {
      const result = await requestJson<{ trip: Trip }>(`/api/logistics/trips/${selectedTrip.id}`, {
        method: 'PUT',
        headers: { 'Idempotency-Key': idempotencyKey(scope) },
        body: JSON.stringify({
          deliveryRouteId: tripDraft.deliveryRouteId || null,
          vehicleId: tripDraft.vehicleId || null,
          primaryDriverId: tripDraft.primaryDriverId || null,
          plannedStartAt: tripDraft.plannedStartAt ? new Date(tripDraft.plannedStartAt).toISOString() : null,
          note: tripDraft.note || null,
        }),
      });
      setSelectedTrip(result.trip);
      await loadLists();
      setMessage('Đã cập nhật kế hoạch chuyến.');
    });
  }

  async function tripAction(action: 'assign' | 'unassign' | 'reorder' | 'plan' | 'reopen' | 'lock', body: unknown, discriminator: string) {
    if (!selectedTrip) return;
    const scope = keyScope(action, selectedTrip.id, selectedTrip.revision, discriminator);
    await runOperation(scope, async () => {
      const result = await requestJson<{ trip: Trip }>(`/api/logistics/trips/${selectedTrip.id}/${action}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey(scope) },
        body: JSON.stringify(body),
      });
      setSelectedTrip(result.trip);
      await loadLists();
      setMessage({
        assign: 'Đã gán phiếu giao vào chuyến.',
        unassign: 'Đã bỏ phiếu giao khỏi chuyến.',
        reorder: 'Đã cập nhật thứ tự điểm giao.',
        plan: 'Chuyến đã chuyển sang trạng thái lập kế hoạch.',
        reopen: 'Chuyến đã mở lại để chỉnh sửa.',
        lock: 'Kế hoạch chuyến đã khóa.',
      }[action]);
    });
  }

  async function moveStop(stopId: string, direction: -1 | 1) {
    if (!selectedTrip?.stops) return;
    const stopIds = selectedTrip.stops.map((stop) => stop.id);
    const index = stopIds.indexOf(stopId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= stopIds.length) return;
    [stopIds[index], stopIds[target]] = [stopIds[target], stopIds[index]];
    await tripAction('reorder', { stopIds }, stopIds.join('-'));
  }

  const selectedEligible = eligible.filter((order) => order.warehouseId === selectedTrip?.warehouseId);
  const editable = selectedTrip !== null && selectedTrip.status !== 'locked';
  const canPlan = selectedTrip?.status === 'draft' && Boolean(selectedTrip.stops?.length);
  const canLock = selectedTrip?.status === 'planned';

  return (
    <AppShell
      kicker="Giao nhận"
      title="Điều phối giao hàng"
      subtitle="Lập chuyến, xếp điểm giao, gán xe và tài xế; chưa xuất kho hay ghi kết quả giao."
    >
      <div className={styles.workspace} data-testid="trip-planning-workspace">
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {message ? <p className={styles.message} role="status">{message}</p> : null}

        <section className={styles.section} aria-labelledby="logistics-master-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Danh mục điều phối</p>
              <h2 id="logistics-master-heading">Tuyến, xe và tài xế</h2>
            </div>
          </div>
          <div className={styles.masterGrid}>
            <MasterForm
              title="Tuyến giao"
              draft={routeDraft}
              labels={['Mã tuyến', 'Tên tuyến', 'Mô tả']}
              onChange={setRouteDraft}
              onSubmit={() => createMaster('routes', routeDraft)}
              disabled={busy !== null}
              testId="create-route"
            />
            <MasterForm
              title="Phương tiện"
              draft={vehicleDraft}
              labels={['Mã xe', 'Biển số', 'Loại xe']}
              onChange={setVehicleDraft}
              onSubmit={() => createMaster('vehicles', vehicleDraft)}
              disabled={busy !== null}
              testId="create-vehicle"
            />
            <MasterForm
              title="Tài xế"
              draft={driverDraft}
              labels={['Mã tài xế', 'Tên tài xế', 'Số điện thoại']}
              onChange={setDriverDraft}
              onSubmit={() => createMaster('drivers', driverDraft)}
              disabled={busy !== null}
              testId="create-driver"
            />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="create-trip-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Kế hoạch chuyến</p>
              <h2 id="create-trip-heading">Tạo chuyến giao</h2>
            </div>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={createTrip}
              disabled={busy !== null || !tripDraft.warehouseId}
              data-testid="create-trip-button"
            >
              Tạo chuyến
            </button>
          </div>
          <TripFields
            draft={tripDraft}
            setDraft={setTripDraft}
            warehouses={warehouses}
            routes={routes}
            vehicles={vehicles}
            drivers={drivers}
            disabled={busy !== null}
          />
        </section>

        <div className={styles.columns}>
          <section className={styles.section} aria-labelledby="trip-list-heading">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Danh sách</p>
                <h2 id="trip-list-heading">Các chuyến giao</h2>
              </div>
              <button type="button" className={styles.secondaryButton} onClick={() => loadLists()} disabled={busy !== null}>
                Tải lại
              </button>
            </div>
            <div className={styles.list} data-testid="trip-list">
              {trips.map((trip) => (
                <button
                  type="button"
                  key={trip.id}
                  className={`${styles.listItem} ${selectedTrip?.id === trip.id ? styles.selected : ''}`}
                  onClick={() => runOperation(`load-${trip.id}`, () => loadTrip(trip.id))}
                >
                  <strong>{trip.number}</strong>
                  <span>{trip.warehouseCode || 'Kho'} · {statusLabel(trip.status)}</span>
                  <small>{trip.stopCount || 0} điểm · {trip.assignmentCount || 0} phiếu</small>
                </button>
              ))}
              {!trips.length && busy !== 'load' ? <p className={styles.empty}>Chưa có chuyến giao.</p> : null}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="trip-detail-heading">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Chi tiết</p>
                <h2 id="trip-detail-heading">{selectedTrip ? selectedTrip.number : 'Chọn một chuyến'}</h2>
              </div>
              {selectedTrip ? <span className={styles.status} data-status={selectedTrip.status}>{statusLabel(selectedTrip.status)}</span> : null}
            </div>

            {selectedTrip ? (
              <>
                <TripFields
                  draft={tripDraft}
                  setDraft={setTripDraft}
                  warehouses={warehouses}
                  routes={routes}
                  vehicles={vehicles}
                  drivers={drivers}
                  disabled={busy !== null || !editable}
                  lockWarehouse
                />
                <div className={styles.actions}>
                  {editable ? (
                    <button type="button" className={styles.secondaryButton} onClick={updateTrip} disabled={busy !== null}>
                      Lưu kế hoạch
                    </button>
                  ) : null}
                  {canPlan ? (
                    <button type="button" className={styles.primaryButton} onClick={() => tripAction('plan', {}, 'plan')} disabled={busy !== null} data-testid="plan-trip-button">
                      Chuyển sang đã lập kế hoạch
                    </button>
                  ) : null}
                  {selectedTrip.status === 'planned' ? (
                    <button type="button" className={styles.secondaryButton} onClick={() => tripAction('reopen', { reason: 'Điều chỉnh kế hoạch trước khi khóa' }, 'reopen')} disabled={busy !== null}>
                      Mở lại chỉnh sửa
                    </button>
                  ) : null}
                  {canLock ? (
                    <button type="button" className={styles.dangerButton} onClick={() => tripAction('lock', {}, 'lock')} disabled={busy !== null} data-testid="lock-trip-button">
                      Khóa kế hoạch
                    </button>
                  ) : null}
                </div>

                <div className={styles.stopList} data-testid="trip-stop-list">
                  {(selectedTrip.stops || []).map((stop, index) => (
                    <article className={styles.stopCard} key={stop.id}>
                      <header>
                        <div>
                          <strong>Điểm {stop.sequence}</strong>
                          <p>{addressLabel(stop.address)}</p>
                        </div>
                        {editable ? (
                          <div className={styles.moveButtons}>
                            <button type="button" onClick={() => moveStop(stop.id, -1)} disabled={busy !== null || index === 0} aria-label="Đưa điểm giao lên">
                              ↑
                            </button>
                            <button type="button" onClick={() => moveStop(stop.id, 1)} disabled={busy !== null || index === (selectedTrip.stops?.length || 0) - 1} aria-label="Đưa điểm giao xuống">
                              ↓
                            </button>
                          </div>
                        ) : null}
                      </header>
                      {stop.assignments.map((assignment) => (
                        <div className={styles.assignment} key={assignment.assignmentId}>
                          <span>
                            <strong>{assignment.deliveryOrderNumber || assignment.deliveryOrderId.slice(0, 8)}</strong>
                            <small>{assignment.customerCode} · {assignment.customerName}</small>
                          </span>
                          {editable ? (
                            <button
                              type="button"
                              className={styles.textButton}
                              onClick={() => tripAction('unassign', {
                                deliveryOrderId: assignment.deliveryOrderId,
                                reason: 'Điều chỉnh kế hoạch chuyến',
                              }, assignment.deliveryOrderId)}
                              disabled={busy !== null}
                            >
                              Bỏ khỏi chuyến
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </article>
                  ))}
                  {!selectedTrip.stops?.length ? <p className={styles.empty}>Chưa có điểm giao.</p> : null}
                </div>

                <div className={styles.readyQueue}>
                  <h3>Phiếu sẵn sàng cùng kho</h3>
                  {selectedEligible.map((order) => (
                    <div className={styles.readyItem} key={order.id}>
                      <span>
                        <strong>{order.number || order.id.slice(0, 8)}</strong>
                        <small>{order.customerCode} · {order.customerName}</small>
                        <small>{formatQuantity(order.totalBaseQuantity)} · {order.lineCount} dòng</small>
                      </span>
                      {editable ? (
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={() => tripAction('assign', { deliveryOrderId: order.id }, order.id)}
                          disabled={busy !== null}
                          data-testid={`assign-${order.id}`}
                        >
                          Gán vào chuyến
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {!selectedEligible.length ? <p className={styles.empty}>Không còn phiếu giao đủ điều kiện trong kho này.</p> : null}
                </div>

                {selectedTrip.status === 'locked' ? (
                  <p className={styles.lockNotice} data-testid="locked-read-only">
                    Kế hoạch đã khóa. Xe, tài xế, điểm dừng và phiếu giao chỉ được đọc trong Phase 6E.1.
                  </p>
                ) : null}
              </>
            ) : (
              <p className={styles.empty}>Chọn chuyến bên trái để lập kế hoạch.</p>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function MasterForm({
  title,
  draft,
  labels,
  onChange,
  onSubmit,
  disabled,
  testId,
}: {
  title: string;
  draft: MasterDraft;
  labels: [string, string, string];
  onChange: (value: MasterDraft) => void;
  onSubmit: () => void;
  disabled: boolean;
  testId: string;
}) {
  return (
    <div className={styles.masterCard}>
      <h3>{title}</h3>
      <label>{labels[0]}<input value={draft.code} onChange={(event) => onChange({ ...draft, code: event.target.value })} disabled={disabled} /></label>
      <label>{labels[1]}<input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} disabled={disabled} /></label>
      <label>{labels[2]}<input value={draft.extra} onChange={(event) => onChange({ ...draft, extra: event.target.value })} disabled={disabled} /></label>
      <button type="button" className={styles.secondaryButton} onClick={onSubmit} disabled={disabled || !draft.code.trim() || !draft.name.trim()} data-testid={testId}>
        Thêm {title.toLowerCase()}
      </button>
    </div>
  );
}

function TripFields({
  draft,
  setDraft,
  warehouses,
  routes,
  vehicles,
  drivers,
  disabled,
  lockWarehouse = false,
}: {
  draft: TripDraft;
  setDraft: (value: TripDraft) => void;
  warehouses: Array<{ id: string; code: string; name: string }>;
  routes: LogisticsRoute[];
  vehicles: Vehicle[];
  drivers: Driver[];
  disabled: boolean;
  lockWarehouse?: boolean;
}) {
  return (
    <div className={styles.formGrid}>
      <label>
        Kho xuất phát
        <select value={draft.warehouseId} onChange={(event) => setDraft({ ...draft, warehouseId: event.target.value })} disabled={disabled || lockWarehouse} data-testid="trip-warehouse">
          <option value="">Chọn kho</option>
          {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
        </select>
      </label>
      <label>
        Tuyến giao
        <select value={draft.deliveryRouteId} onChange={(event) => setDraft({ ...draft, deliveryRouteId: event.target.value })} disabled={disabled}>
          <option value="">Không dùng tuyến mẫu</option>
          {routes.map((route) => <option key={route.id} value={route.id}>{route.code} · {route.name}</option>)}
        </select>
      </label>
      <label>
        Phương tiện
        <select value={draft.vehicleId} onChange={(event) => setDraft({ ...draft, vehicleId: event.target.value })} disabled={disabled} data-testid="trip-vehicle">
          <option value="">Chọn xe</option>
          {vehicles.filter((vehicle) => vehicle.isActive && vehicle.operationalStatus === 'AVAILABLE').map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>{vehicle.code} · {vehicle.licensePlate}</option>
          ))}
        </select>
      </label>
      <label>
        Tài xế chính
        <select value={draft.primaryDriverId} onChange={(event) => setDraft({ ...draft, primaryDriverId: event.target.value })} disabled={disabled} data-testid="trip-driver">
          <option value="">Chọn tài xế</option>
          {drivers.filter((driver) => driver.isActive).map((driver) => <option key={driver.id} value={driver.id}>{driver.code} · {driver.name}</option>)}
        </select>
      </label>
      <label>
        Giờ dự kiến
        <input type="datetime-local" value={draft.plannedStartAt} onChange={(event) => setDraft({ ...draft, plannedStartAt: event.target.value })} disabled={disabled} />
      </label>
      <label className={styles.noteField}>
        Ghi chú
        <input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} disabled={disabled} />
      </label>
    </div>
  );
}
