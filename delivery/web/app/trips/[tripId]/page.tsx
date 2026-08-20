import Link from 'next/link';
import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../lib/delivery-auth';
import { getMyTrip } from '../../../lib/core-api';
import { getMyCodOverview } from '../../../lib/cod-api';
import type { CodAssignment } from '../../../lib/types';
import {
  customerPhoneFromSnapshot,
  formatAddress,
  formatCollectionPolicy,
  formatDateTime,
  locationUrlFromSnapshot,
  safeErrorMessage,
} from '../../../lib/presentation';
import CodCollectionDialog from './cod-collection-dialog';
import CodHandoverPanel from './cod-handover-panel';
import CustomerStopActions from './customer-stop-actions';
import DeliveryAttemptPanel from './delivery-attempt-panel';
import DeliveryOrderDetailDialog from './delivery-order-detail-dialog';
import styles from './trip-customer.module.css';

export const dynamic = 'force-dynamic';

type PageProps = Readonly<{ params: { tripId: string } }>;

function assignmentAnchor(value: string) {
  return `assignment-${String(value).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function money(value: string | null | undefined, currencyCode: string | null | undefined) {
  const number = Number(value ?? 0);
  const currency = currencyCode || 'VND';
  if (!Number.isFinite(number)) return `${value ?? '0'} ${currency}`;
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(number);
}

export default async function TripDetailPage({ params }: PageProps) {
  if (deliverySetupPending()) {
    return (
      <main className="pageShell">
        <section className="stateCard" id="next-delivery-action">
          <strong>Chưa mở dữ liệu chuyến</strong>
          <p>Ứng dụng đang chờ hồ sơ tài xế thật được tạo và liên kết với nhân viên.</p>
        </section>
      </main>
    );
  }

  const user = authenticateDeliveryUser(headers().get('authorization'));
  if (!user) {
    return (
      <main className="pageShell">
        <section className="stateCard errorCard" id="next-delivery-action">
          <strong>Không xác định được tài xế</strong>
          <p>Vui lòng tải lại trang và đăng nhập lại.</p>
        </section>
      </main>
    );
  }

  try {
    const [result, codOverview] = await Promise.all([
      getMyTrip(user, params.tripId),
      getMyCodOverview(user, params.tripId),
    ]);
    const { trip } = result;
    const codByAssignment = new Map<string, CodAssignment>(
      codOverview.assignments.map((assignment) => [assignment.assignmentId, assignment]),
    );
    const attemptCount = trip.stops?.reduce(
      (total, stop) => total + stop.assignments.filter((assignment) => assignment.attempt).length,
      0,
    ) ?? 0;
    const assignmentCount = trip.stops?.reduce(
      (total, stop) => total + stop.assignments.length,
      0,
    ) ?? 0;
    const nextStop = trip.stops?.find((stop) => stop.assignments.some((assignment) => !assignment.attempt));

    return (
      <main className="pageShell tripDetailShell">
        <header className="detailHeader deliveryTripHeader">
          <div>
            <p className="eyebrow">Chuyến đang giao</p>
            <h1>{trip.number}</h1>
            <p className="welcome">{trip.warehouseName || trip.warehouseCode || 'Chưa có kho'} · Đã xuất phát</p>
          </div>
          <span className="statusPill">{attemptCount}/{assignmentCount} phiếu</span>
        </header>

        {nextStop ? (
          <div className={styles.nextPointer}>
            <strong>Điểm tiếp theo: #{nextStop.sequence}</strong>
            <a href="#next-delivery-action">Mở điểm giao ↓</a>
          </div>
        ) : (
          <section className="nextStopCard completed" id="next-delivery-action">
            <div className="nextStopTopline"><span>Tiến độ chuyến</span><b>Chờ Công Ty đối soát</b></div>
            <h2>Đã ghi kết quả tất cả phiếu giao</h2>
            <p className="nextStopAddress">Công Ty cần kiểm tra bằng chứng, tiền COD và hàng quay về trước khi đóng chuyến.</p>
          </section>
        )}

        <section className="tripOverview compactTripOverview">
          <div className="deliverySectionHeading compact">
            <h2>Thông tin chuyến</h2>
            <span>{trip.stops?.length ?? 0} điểm</span>
          </div>
          <dl className="summaryGrid">
            <div><dt>Tài xế</dt><dd>{trip.driverName || user.displayName}</dd></div>
            <div><dt>Biển số</dt><dd>{trip.licensePlate || trip.vehicleCode || 'Chưa có'}</dd></div>
            <div><dt>Kho xuất</dt><dd>{trip.warehouseName || trip.warehouseCode || 'Chưa có'}</dd></div>
            <div><dt>Xuất phát</dt><dd>{formatDateTime(trip.dispatchedAt)}</dd></div>
          </dl>
          {trip.handoverNote ? <p className="handoverNote">Ghi chú bàn giao: {trip.handoverNote}</p> : null}
        </section>

        <section className="stopSection" id="route-section">
          <div className="deliverySectionHeading">
            <div><p className="eyebrow">Lộ trình</p><h2>Thứ tự điểm giao</h2></div>
            <span>{trip.stops?.length ?? 0} điểm</span>
          </div>
          {!trip.stops?.length ? (
            <div className="stateCard"><strong>Chưa có điểm giao</strong><p>Vui lòng liên hệ điều phối để kiểm tra chuyến.</p></div>
          ) : (
            <ol className="stopList">
              {trip.stops.map((stop) => {
                const isNextStop = nextStop?.id === stop.id;
                const primaryAssignment = stop.assignments[0];
                const customerName = primaryAssignment?.customerName || primaryAssignment?.customerCode || 'Khách hàng';
                const address = formatAddress(stop.address);
                const phone = customerPhoneFromSnapshot(stop.address);
                const locationUrl = locationUrlFromSnapshot(stop.address);
                return (
                  <li
                    className={`${isNextStop ? 'stopCard nextStop' : 'stopCard'} ${styles.stopWorkspace}`}
                    id={isNextStop ? 'next-delivery-action' : undefined}
                    key={stop.id}
                  >
                    <div className="stopSequence" aria-label={`Điểm số ${stop.sequence}`}>{stop.sequence}</div>
                    <div className="stopBody">
                      <div className="stopHeadingRow">
                        <div className={styles.customerHeading}>
                          <h3>{customerName}</h3>
                          <p>{address}</p>
                        </div>
                        {isNextStop ? <span className="nextStopBadge">Tiếp theo</span> : null}
                      </div>
                      {stop.plannedArrivalAt ? <p className={styles.plannedAt}>Dự kiến: {formatDateTime(stop.plannedArrivalAt)}</p> : null}
                      <CustomerStopActions
                        tripId={trip.id}
                        customerId={stop.customerId}
                        customerName={customerName}
                        address={address}
                        phone={phone}
                        locationUrl={locationUrl}
                      />

                      <div className={`deliveryOrders ${styles.deliveryOrders}`}>
                        {stop.assignments.map((assignment) => {
                          const codAssignment = codByAssignment.get(assignment.assignmentId);
                          const codRelevant = Boolean(
                            codAssignment
                            && codAssignment.collectionPolicy === 'COLLECT_ON_DELIVERY'
                            && ['delivered_full', 'delivered_partial'].includes(codAssignment.deliveryAttemptResult ?? ''),
                          );
                          const firstItem = assignment.lines[0];
                          return (
                            <article
                              className={`${assignment.attempt ? 'deliveryOrder completedAssignment' : 'deliveryOrder'} ${styles.deliveryOrder}`}
                              id={assignmentAnchor(assignment.assignmentId)}
                              key={assignment.assignmentId}
                            >
                              <div className="deliveryOrderHeading">
                                <div>
                                  <strong>{assignment.deliveryOrderNumber || 'Phiếu giao chưa có số'}</strong>
                                  <span>{formatCollectionPolicy(assignment.collectionPolicy)}</span>
                                </div>
                                <span className={assignment.attempt ? 'assignmentState done' : 'assignmentState'}>{assignment.attempt ? 'Đã ghi' : 'Chờ ghi'}</span>
                              </div>

                              <div className={styles.orderValueRow}>
                                <span>Giá trị đơn</span>
                                <strong>
                                  {assignment.totalAmount !== null && assignment.totalAmount !== undefined
                                    ? money(assignment.totalAmount, assignment.currencyCode)
                                    : 'Chưa có dữ liệu giá'}
                                </strong>
                              </div>

                              <p className={styles.goodsSummary}>
                                {assignment.lines.length > 0
                                  ? `${assignment.lines.length} mặt hàng · ${firstItem?.itemName || firstItem?.sku || 'Hàng giao'}`
                                  : 'Chưa có dữ liệu hàng xuất kho'}
                              </p>
                              {assignment.requestedDeliveryDate ? (
                                <p className={styles.requestedDate}>Ngày yêu cầu: {assignment.requestedDeliveryDate}</p>
                              ) : null}

                              <div className={styles.assignmentActions}>
                                <DeliveryOrderDetailDialog assignment={assignment} />
                                <DeliveryAttemptPanel tripId={trip.id} assignment={assignment} />
                                {codRelevant && codAssignment ? (
                                  <CodCollectionDialog tripId={trip.id} assignment={codAssignment} />
                                ) : null}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section id="cod-section" className="codSectionAnchor">
          <CodHandoverPanel tripId={trip.id} overview={codOverview} />
        </section>

        <section className="noticeCard deliveryBoundaryNote">
          <strong>Delivery chỉ ghi sự thật ngoài tuyến</strong>
          <p>Kết quả giao, tiền khách thực trả và bàn giao tiền mặt được ghi riêng. Kế toán NPP xác nhận tiền công ty nhận; Delivery không sửa công nợ trực tiếp.</p>
        </section>
      </main>
    );
  } catch (error) {
    return (
      <main className="pageShell">
        <Link className="backLink" href="/">← Chuyến của tôi</Link>
        <section className="stateCard errorCard" id="next-delivery-action">
          <strong>Không mở được chuyến</strong>
          <p>{safeErrorMessage(error)}</p>
        </section>
      </main>
    );
  }
}
