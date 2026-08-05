import Link from 'next/link';
import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../lib/delivery-auth';
import { getMyTrip } from '../../../lib/core-api';
import { formatAddress, formatDateTime, safeErrorMessage } from '../../../lib/presentation';
import DeliveryAttemptPanel from './delivery-attempt-panel';

export const dynamic = 'force-dynamic';

type PageProps = Readonly<{ params: { tripId: string } }>;

function assignmentAnchor(value: string) {
  return `assignment-${String(value).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
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
    const result = await getMyTrip(user, params.tripId);
    const { trip } = result;
    const attemptCount = trip.stops?.reduce(
      (total, stop) => total + stop.assignments.filter((assignment) => assignment.attempt).length,
      0,
    ) ?? 0;
    const assignmentCount = trip.stops?.reduce(
      (total, stop) => total + stop.assignments.length,
      0,
    ) ?? 0;
    const nextStop = trip.stops?.find((stop) => stop.assignments.some((assignment) => !assignment.attempt));
    const nextAssignment = nextStop?.assignments.find((assignment) => !assignment.attempt);

    return (
      <main className="pageShell tripDetailShell">
        <header className="detailHeader deliveryTripHeader">
          <div>
            <p className="eyebrow">Chuyến đang giao</p>
            <h1>{trip.number}</h1>
            <p className="welcome">{trip.licensePlate || trip.vehicleCode || 'Chưa có xe'} · {trip.warehouseName || trip.warehouseCode || 'Chưa có kho'}</p>
          </div>
          <span className="statusPill">{attemptCount}/{assignmentCount} phiếu</span>
        </header>

        {nextStop && nextAssignment ? (
          <section className="nextStopCard" id="next-delivery-action" aria-labelledby="next-stop-heading">
            <div className="nextStopTopline">
              <span>Điểm tiếp theo</span>
              <b>#{nextStop.sequence}</b>
            </div>
            <h2 id="next-stop-heading">{nextAssignment.customerName || nextAssignment.customerCode || 'Khách hàng'}</h2>
            <p className="nextStopAddress">{formatAddress(nextStop.address)}</p>
            <div className="nextStopMeta">
              <span>{nextAssignment.deliveryOrderNumber || 'Phiếu giao chưa có số'}</span>
              {nextStop.plannedArrivalAt ? <span>Dự kiến {formatDateTime(nextStop.plannedArrivalAt)}</span> : null}
            </div>
            <a className="nextStopAction" href={`#${assignmentAnchor(nextAssignment.assignmentId)}`}>
              <span aria-hidden="true">✓</span>
              <strong>Ghi kết quả giao hàng</strong>
              <b aria-hidden="true">›</b>
            </a>
          </section>
        ) : (
          <section className="nextStopCard completed" id="next-delivery-action">
            <div className="nextStopTopline"><span>Tiến độ chuyến</span><b>Hoàn tất</b></div>
            <h2>Đã ghi kết quả tất cả phiếu giao</h2>
            <p className="nextStopAddress">Kiểm tra lại bằng chứng và ghi chú trước khi kết thúc công việc.</p>
          </section>
        )}

        <section className="tripOverview compactTripOverview">
          <div className="deliverySectionHeading compact">
            <h2>Thông tin chuyến</h2>
            <span>{trip.stops?.length ?? 0} điểm</span>
          </div>
          <dl className="summaryGrid">
            <div>
              <dt>Tài xế</dt>
              <dd>{trip.driverName || user.displayName}</dd>
            </div>
            <div>
              <dt>Biển số</dt>
              <dd>{trip.licensePlate || trip.vehicleCode || 'Chưa có'}</dd>
            </div>
            <div>
              <dt>Kho xuất</dt>
              <dd>{trip.warehouseName || trip.warehouseCode || 'Chưa có'}</dd>
            </div>
            <div>
              <dt>Xuất phát</dt>
              <dd>{formatDateTime(trip.dispatchedAt)}</dd>
            </div>
          </dl>
          {trip.handoverNote ? <p className="handoverNote">Ghi chú bàn giao: {trip.handoverNote}</p> : null}
        </section>

        <section className="stopSection">
          <div className="deliverySectionHeading">
            <div>
              <p className="eyebrow">Lộ trình</p>
              <h2>Thứ tự điểm giao</h2>
            </div>
            <span>{trip.stops?.length ?? 0} điểm</span>
          </div>
          {!trip.stops?.length ? (
            <div className="stateCard">
              <strong>Chưa có điểm giao</strong>
              <p>Vui lòng liên hệ điều phối để kiểm tra chuyến.</p>
            </div>
          ) : (
            <ol className="stopList">
              {trip.stops.map((stop) => {
                const isNextStop = nextStop?.id === stop.id;
                return (
                  <li className={isNextStop ? 'stopCard nextStop' : 'stopCard'} key={stop.id}>
                    <div className="stopSequence" aria-label={`Điểm số ${stop.sequence}`}>{stop.sequence}</div>
                    <div className="stopBody">
                      <div className="stopHeadingRow">
                        <p className="stopAddress">{formatAddress(stop.address)}</p>
                        {isNextStop ? <span className="nextStopBadge">Tiếp theo</span> : null}
                      </div>
                      {stop.plannedArrivalAt ? (
                        <p className="mutedText">Dự kiến: {formatDateTime(stop.plannedArrivalAt)}</p>
                      ) : null}
                      <div className="deliveryOrders">
                        {stop.assignments.map((assignment) => (
                          <article
                            className={assignment.attempt ? 'deliveryOrder completedAssignment' : 'deliveryOrder'}
                            id={assignmentAnchor(assignment.assignmentId)}
                            key={assignment.assignmentId}
                          >
                            <div className="deliveryOrderHeading">
                              <div>
                                <strong>{assignment.customerName || assignment.customerCode || 'Khách hàng'}</strong>
                                <span>{assignment.deliveryOrderNumber || 'Phiếu giao chưa có số'}</span>
                              </div>
                              <span className={assignment.attempt ? 'assignmentState done' : 'assignmentState'}>
                                {assignment.attempt ? 'Đã ghi' : 'Chờ ghi'}
                              </span>
                            </div>
                            <dl>
                              <div>
                                <dt>Ngày yêu cầu</dt>
                                <dd>{assignment.requestedDeliveryDate || 'Chưa có'}</dd>
                              </div>
                              <div>
                                <dt>Thu tiền</dt>
                                <dd>{assignment.collectionPolicy || 'Theo phiếu'}</dd>
                              </div>
                            </dl>
                            <DeliveryAttemptPanel tripId={trip.id} assignment={assignment} />
                          </article>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="noticeCard deliveryBoundaryNote">
          <strong>Hàng chưa giao vẫn ở trên xe</strong>
          <p>Màn này chỉ ghi kết quả lần giao; hàng chưa giao không tự nhập lại kho và chưa xử lý thu tiền.</p>
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
