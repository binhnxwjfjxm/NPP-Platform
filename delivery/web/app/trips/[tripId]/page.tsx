import Link from 'next/link';
import { headers } from 'next/headers';
import { authenticateDeliveryUser, deliverySetupPending } from '../../../lib/delivery-auth';
import { getMyTrip } from '../../../lib/core-api';
import { formatAddress, formatDateTime, safeErrorMessage } from '../../../lib/presentation';
import DeliveryAttemptPanel from './delivery-attempt-panel';

export const dynamic = 'force-dynamic';

type PageProps = Readonly<{ params: { tripId: string } }>;

export default async function TripDetailPage({ params }: PageProps) {
  if (deliverySetupPending()) {
    return (
      <main className="pageShell">
        <Link className="backLink" href="/">← Ứng dụng Giao hàng</Link>
        <section className="stateCard">
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
        <section className="stateCard errorCard">
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

    return (
      <main className="pageShell">
        <Link className="backLink" href="/">← Chuyến của tôi</Link>
        <header className="detailHeader">
          <div>
            <p className="eyebrow">Chuyến đang giao</p>
            <h1>{trip.number}</h1>
          </div>
          <span className="statusPill">{attemptCount}/{assignmentCount} phiếu</span>
        </header>

        <section className="tripOverview">
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
          <div className="sectionHeading">
            <h2>Thứ tự điểm giao</h2>
            <span>{trip.stops?.length ?? 0} điểm</span>
          </div>
          {!trip.stops?.length ? (
            <div className="stateCard">
              <strong>Chưa có điểm giao</strong>
              <p>Vui lòng liên hệ điều phối để kiểm tra chuyến.</p>
            </div>
          ) : (
            <ol className="stopList">
              {trip.stops.map((stop) => (
                <li className="stopCard" key={stop.id}>
                  <div className="stopSequence" aria-label={`Điểm số ${stop.sequence}`}>{stop.sequence}</div>
                  <div className="stopBody">
                    <p className="stopAddress">{formatAddress(stop.address)}</p>
                    {stop.plannedArrivalAt ? (
                      <p className="mutedText">Dự kiến: {formatDateTime(stop.plannedArrivalAt)}</p>
                    ) : null}
                    <div className="deliveryOrders">
                      {stop.assignments.map((assignment) => (
                        <article className="deliveryOrder" key={assignment.assignmentId}>
                          <div>
                            <strong>{assignment.customerName || assignment.customerCode || 'Khách hàng'}</strong>
                            <span>{assignment.deliveryOrderNumber || 'Phiếu giao chưa có số'}</span>
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
              ))}
            </ol>
          )}
        </section>

        <section className="noticeCard">
          <strong>Hàng chưa giao vẫn ở trên xe</strong>
          <p>Màn này ghi kết quả lần giao; bằng chứng giao hàng là tùy chọn. Hàng chưa giao không tự nhập lại kho và chưa xử lý thu tiền.</p>
        </section>
      </main>
    );
  } catch (error) {
    return (
      <main className="pageShell">
        <Link className="backLink" href="/">← Chuyến của tôi</Link>
        <section className="stateCard errorCard">
          <strong>Không mở được chuyến</strong>
          <p>{safeErrorMessage(error)}</p>
        </section>
      </main>
    );
  }
}
