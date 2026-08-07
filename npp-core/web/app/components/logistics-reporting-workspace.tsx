'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { LogisticsDashboard } from '../../lib/logistics-reporting-types';
import { AppShell } from './app-shell';
import styles from './inventory-reporting-workspace.module.css';

type ApiEnvelope<T> = Readonly<{ data?: T; error?: { message?: string } }>;

function count(value: string | null | undefined) {
  const normalized = String(value ?? '0').trim();
  return /^-?\d+$/.test(normalized) ? normalized.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : normalized;
}

function percent(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return normalized ? `${normalized.replace('.', ',')}%` : '—';
}

function duration(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return normalized ? `${normalized.replace('.', ',')} phút` : '—';
}

function timestamp(value: string | null | undefined) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function exceptionLabel(code: string) {
  return ({
    MISSING_PLANNED_ARRIVAL: 'Thiếu giờ dự kiến tại điểm giao',
    PENDING_DELIVERY_RESULT: 'Phiếu đã xuất chuyến nhưng chưa có kết quả giao',
  } as Record<string, string>)[code] ?? code;
}

async function requestReport(from = '', to = '', warehouseId = ''): Promise<LogisticsDashboard> {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (warehouseId) query.set('warehouseId', warehouseId);
  const serialized = query.toString();
  const response = await fetch(`/api/reporting/logistics${serialized ? `?${serialized}` : ''}`, { method: 'GET', cache: 'no-store' });
  const envelope = await response.json().catch(() => ({})) as ApiEnvelope<LogisticsDashboard>;
  if (!response.ok || !envelope.data) throw new Error(envelope.error?.message || 'Không tải được báo cáo giao hàng.');
  return envelope.data;
}

export function LogisticsReportingWorkspace() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [report, setReport] = useState<LogisticsDashboard | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextFrom = '', nextTo = '', nextWarehouseId = '') => {
    setBusy(true);
    setError('');
    try {
      const next = await requestReport(nextFrom, nextTo, nextWarehouseId);
      setReport(next);
      setFrom(next.filters.from);
      setTo(next.filters.to);
      setWarehouseId(next.filters.warehouseId ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không tải được báo cáo giao hàng.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(from, to, warehouseId);
  }

  function resetFilters() {
    setFrom(''); setTo(''); setWarehouseId('');
    void load();
  }

  const summary = report?.summary ?? {};
  const actions = (
    <div className={styles.headerActions}>
      <Link className={styles.linkButton} href="/logistics/trips">Mở chuyến giao</Link>
      <Link className={styles.linkButton} href="/logistics/delivery-attempts">Kết quả lần giao</Link>
    </div>
  );

  return (
    <AppShell
      title="Hiệu suất giao hàng / Logistics"
      subtitle="Theo dõi chuyến, điểm giao, tỷ lệ giao đủ đúng giờ, giao thiếu/thất bại/hẹn lại và khối lượng vận hành theo tài xế, phương tiện từ canonical trip/stop/attempt facts."
      kicker="Giao nhận & điều phối"
      actions={actions}
    >
      <div className={styles.workspace} data-testid="logistics-reporting-workspace">
        <form className={styles.filters} onSubmit={applyFilters}>
          <label className={styles.field}><span>Từ ngày</span><input type="date" value={from} disabled={busy} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className={styles.field}><span>Đến ngày</span><input type="date" value={to} disabled={busy} onChange={(event) => setTo(event.target.value)} /></label>
          <label className={styles.field}><span>Kho</span><select value={warehouseId} disabled={busy} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Tất cả kho được cấp quyền</option>{report?.warehouses.map((row) => <option key={row.warehouseId} value={row.warehouseId}>{row.warehouseCode} — {row.warehouseName}</option>)}</select></label>
          <button className={styles.primaryButton} type="submit" disabled={busy}>Áp dụng</button>
          <button className={styles.secondaryButton} type="button" onClick={resetFilters} disabled={busy}>Tháng hiện tại</button>
        </form>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {busy && !report ? <div className={styles.loading}>Đang tải hiệu suất giao hàng…</div> : null}

        {report ? <>
          <div className={styles.notice}>
            <strong>Nguồn quản trị dùng chung:</strong> Admin Control Tower 8.7 sẽ đọc lại chính contract này. Đúng hạn chỉ tính phiếu <strong>giao đủ</strong> có giờ dự kiến tại điểm giao; dòng thiếu SLA bị loại khỏi mẫu số và hiển thị riêng, không tự coi là đúng hạn.
          </div>

          <div className={styles.cards}>
            <div className={styles.card}><p className={styles.cardLabel}>Chuyến trong kỳ</p><p className={styles.cardValue}>{count(summary.tripCount)}</p><p className={styles.cardHint}>Cohort theo giờ bắt đầu kế hoạch của chuyến.</p></div>
            <div className={styles.card}><p className={styles.cardLabel}>Điểm giao / phiếu giao</p><p className={styles.cardValue}>{count(summary.stopCount)} / {count(summary.deliveryOrderCount)}</p><p className={styles.cardHint}>Nguồn trip stops và dispatch items.</p></div>
            <div className={styles.card}><p className={styles.cardLabel}>Giao đủ</p><p className={styles.cardValue}>{count(summary.deliveredFullCount)}</p><p className={styles.cardHint}>Đúng hạn: {percent(summary.onTimeFullRatePercent)} trên {count(summary.onTimeEligibleFullCount)} phiếu có SLA.</p></div>
            <div className={styles.card}><p className={styles.cardLabel}>Coverage SLA</p><p className={styles.cardValue}>{percent(summary.slaCoveragePercent)}</p><p className={styles.cardHint}>{count(summary.fullWithoutPlanCount)} phiếu giao đủ thiếu giờ dự kiến.</p></div>
            <div className={styles.card}><p className={styles.cardLabel}>Partial / failed / hẹn lại</p><p className={styles.cardValue}>{count(summary.deliveredPartialCount)} / {count(summary.failedCount)} / {count(summary.rescheduledCount)}</p><p className={styles.cardHint}>Không nhập chung vào tỷ lệ giao đủ đúng hạn.</p></div>
            <div className={styles.card}><p className={styles.cardLabel}>Thời lượng chuyến đã đóng</p><p className={styles.cardValue}>{duration(summary.averageClosedTripDurationMinutes)}</p><p className={styles.cardHint}>Từ dispatch tới close; không bịa % công suất xe.</p></div>
          </div>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div><h2>Hiệu suất theo tài xế</h2><p>Khối lượng thực tế theo canonical driver profile; không suy diễn từ tên hiển thị.</p></div></div>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Tài xế</th><th className={styles.numeric}>Chuyến</th><th className={styles.numeric}>Điểm</th><th className={styles.numeric}>Phiếu</th><th className={styles.numeric}>Giao đủ</th><th className={styles.numeric}>Partial</th><th className={styles.numeric}>Fail</th><th className={styles.numeric}>Hẹn lại</th><th className={styles.numeric}>Đúng hạn</th><th className={styles.numeric}>TB chuyến đóng</th></tr></thead><tbody>
              {report.drivers.map((row) => <tr key={row.driverProfileId ?? 'unassigned'}><td><strong>{row.driverCode ?? 'Chưa gán'}</strong><br />{row.driverName ?? '—'}</td><td className={styles.numeric}>{count(row.tripCount)}</td><td className={styles.numeric}>{count(row.stopCount)}</td><td className={styles.numeric}>{count(row.deliveryOrderCount)}</td><td className={styles.numeric}>{count(row.deliveredFullCount)}</td><td className={styles.numeric}>{count(row.deliveredPartialCount)}</td><td className={styles.numeric}>{count(row.failedCount)}</td><td className={styles.numeric}>{count(row.rescheduledCount)}</td><td className={styles.numeric}>{percent(row.onTimeFullRatePercent)}</td><td className={styles.numeric}>{duration(row.averageClosedTripDurationMinutes)}</td></tr>)}
              {!report.drivers.length ? <tr><td className={styles.empty} colSpan={10}>Không có chuyến trong kỳ.</td></tr> : null}
            </tbody></table></div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div><h2>Hiệu suất theo phương tiện</h2><p>Chỉ báo khối lượng sử dụng và thời lượng thật; chưa có tải thực tế canonical nên không tính phần trăm tải/công suất.</p></div></div>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Xe</th><th className={styles.numeric}>Chuyến</th><th className={styles.numeric}>Điểm</th><th className={styles.numeric}>Phiếu</th><th className={styles.numeric}>Giao đủ</th><th className={styles.numeric}>Partial</th><th className={styles.numeric}>Fail</th><th className={styles.numeric}>Hẹn lại</th><th className={styles.numeric}>Đúng hạn</th><th className={styles.numeric}>TB chuyến đóng</th></tr></thead><tbody>
              {report.vehicles.map((row) => <tr key={row.vehicleId ?? 'unassigned'}><td><strong>{row.vehicleCode ?? 'Chưa gán'}</strong><br />{row.licensePlate ?? '—'}{row.vehicleType ? ` · ${row.vehicleType}` : ''}</td><td className={styles.numeric}>{count(row.tripCount)}</td><td className={styles.numeric}>{count(row.stopCount)}</td><td className={styles.numeric}>{count(row.deliveryOrderCount)}</td><td className={styles.numeric}>{count(row.deliveredFullCount)}</td><td className={styles.numeric}>{count(row.deliveredPartialCount)}</td><td className={styles.numeric}>{count(row.failedCount)}</td><td className={styles.numeric}>{count(row.rescheduledCount)}</td><td className={styles.numeric}>{percent(row.onTimeFullRatePercent)}</td><td className={styles.numeric}>{duration(row.averageClosedTripDurationMinutes)}</td></tr>)}
              {!report.vehicles.length ? <tr><td className={styles.empty} colSpan={10}>Không có phương tiện trong kỳ.</td></tr> : null}
            </tbody></table></div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div><h2>Lý do giao thất bại / hẹn lại</h2><p>Chỉ dùng reason code canonical đã ghi cùng immutable delivery attempt.</p></div><Link className={styles.linkButton} href="/logistics/delivery-attempts">Mở kết quả lần giao</Link></div>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Kết quả</th><th>Lý do</th><th className={styles.numeric}>Số lần</th></tr></thead><tbody>
              {report.failureReasons.map((row) => <tr key={`${row.result}:${row.reasonCode}`}><td>{row.result}</td><td><code>{row.reasonCode}</code></td><td className={styles.numeric}>{count(row.attemptCount)}</td></tr>)}
              {!report.failureReasons.length ? <tr><td className={styles.empty} colSpan={3}>Không có failure/reschedule trong kỳ.</td></tr> : null}
            </tbody></table></div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div><h2>100 chuyến gần nhất trong bộ lọc</h2><p>Giữ source ID thật; drill-down chỉ sang các màn Logistics/Delivery Order đang tồn tại.</p></div><div className={styles.headerActions}><Link className={styles.linkButton} href="/logistics/trips">Chuyến giao</Link><Link className={styles.linkButton} href="/inventory/delivery-orders">Phiếu giao hàng</Link><Link className={styles.linkButton} href="/logistics/trip-reconciliation">Đối soát cuối chuyến</Link></div></div>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Chuyến</th><th>Kho</th><th>Tài xế / xe</th><th>Thời gian</th><th>Trạng thái</th><th className={styles.numeric}>Điểm / phiếu</th><th className={styles.numeric}>Full / partial</th><th className={styles.numeric}>Fail / hẹn</th><th className={styles.numeric}>Đúng hạn</th><th className={styles.numeric}>Chưa kết quả</th></tr></thead><tbody>
              {report.trips.map((row) => <tr key={row.tripId}><td><strong>{row.tripNumber}</strong><br /><code>{row.tripId}</code></td><td>{row.warehouseCode}<br />{row.warehouseName}</td><td>{row.driverCode ?? '—'} · {row.driverName ?? '—'}<br />{row.vehicleCode ?? '—'} · {row.licensePlate ?? '—'}</td><td>KH {timestamp(row.plannedStartAt)}<br />Đi {timestamp(row.dispatchedAt)}<br />Đóng {timestamp(row.closedAt)}</td><td>{row.status}</td><td className={styles.numeric}>{count(row.stopCount)} / {count(row.deliveryOrderCount)}</td><td className={styles.numeric}>{count(row.deliveredFullCount)} / {count(row.deliveredPartialCount)}</td><td className={styles.numeric}>{count(row.failedCount)} / {count(row.rescheduledCount)}</td><td className={styles.numeric}>{percent(row.onTimeFullRatePercent)}</td><td className={styles.numeric}>{count(row.pendingResultCount)}</td></tr>)}
              {!report.trips.length ? <tr><td className={styles.empty} colSpan={10}>Không có chuyến có planned start trong kỳ.</td></tr> : null}
            </tbody></table></div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}><div><h2>Exception & reconciliation</h2><p>Không giấu thiếu SLA hoặc phiếu đã xuất chuyến chưa có kết quả. Receipt chỉ đếm chứng từ POSTED, không cộng quantity khác SKU thành một số vô nghĩa.</p></div></div>
            <div className={styles.cards}>
              <div className={styles.card}><p className={styles.cardLabel}>Return receipt POSTED</p><p className={styles.cardValue}>{count(report.reconciliation.postedReturnReceiptCount)}</p><p className={styles.cardHint}>{count(report.reconciliation.tripsWithReturnReceiptCount)} chuyến có nhận hàng chưa giao về kho.</p></div>
              {report.dataQuality.exceptions.map((row) => <div className={styles.card} key={row.exceptionCode}><p className={styles.cardLabel}>{exceptionLabel(row.exceptionCode)}</p><p className={styles.cardValue}>{count(row.exceptionCount)}</p><p className={styles.cardHint}>Cần xử lý ở source vận hành; reporting không tự suy diễn.</p></div>)}
            </div>
          </section>

          <div className={styles.sourceNote}>Nguồn: trip → stop → dispatch item → immutable delivery attempt → reconciliation receipt. Generated at {timestamp(report.generatedAt)} · timezone {report.timezone}.</div>
        </> : null}
      </div>
    </AppShell>
  );
}