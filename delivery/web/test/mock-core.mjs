import http from 'node:http';

const employeeId = '10000000-0000-4000-8000-000000000001';
const tripId = '30000000-0000-4000-8000-000000000001';
const token = 'delivery-core-test-token-000000';

const trip = {
  id: tripId,
  number: 'TRP-20260804-00001',
  status: 'dispatched',
  warehouseId: '20000000-0000-4000-8000-000000000001',
  warehouseCode: 'KHO-01',
  warehouseName: 'Kho trung tâm',
  vehicleId: '40000000-0000-4000-8000-000000000001',
  vehicleCode: 'XE-01',
  licensePlate: '51A-123.45',
  vehicleType: 'Xe tải nhẹ',
  primaryDriverId: '50000000-0000-4000-8000-000000000001',
  driverCode: 'TX-01',
  driverName: 'Nguyễn Văn Tài',
  driverPhone: '0900000000',
  plannedStartAt: '2026-08-04T01:00:00.000Z',
  dispatchedAt: '2026-08-04T02:00:00.000Z',
  handoverReceiverName: 'Nguyễn Văn Tài',
  handoverNote: 'Đủ 2 phiếu giao',
  note: null,
  stopCount: 2,
  assignmentCount: 2,
};

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`
      || req.headers['x-npp-delivery-employee-id'] !== employeeId) {
    json(res, 401, { error: { code: 'UNAUTHORIZED' } });
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1:4010');
  if (url.pathname === '/api/logistics/driver/trips') {
    json(res, 200, {
      data: {
        driver: { id: trip.primaryDriverId, code: 'TX-01', name: trip.driverName, employeeId },
        trips: [trip],
      },
    });
    return;
  }
  if (url.pathname === `/api/logistics/driver/trips/${tripId}`) {
    json(res, 200, {
      data: {
        driver: { id: trip.primaryDriverId, code: 'TX-01', name: trip.driverName, employeeId },
        trip: {
          ...trip,
          stops: [
            {
              id: '60000000-0000-4000-8000-000000000001',
              sequence: 1,
              customerId: '70000000-0000-4000-8000-000000000001',
              customerAddressId: '80000000-0000-4000-8000-000000000001',
              address: { line1: '12 Nguyễn Trãi', districtName: 'Quận 5', provinceName: 'TP.HCM' },
              plannedArrivalAt: null,
              assignments: [
                {
                  assignmentId: '90000000-0000-4000-8000-000000000001',
                  deliveryOrderId: '91000000-0000-4000-8000-000000000001',
                  deliveryOrderNumber: 'DO-0001',
                  salesOrderId: '92000000-0000-4000-8000-000000000001',
                  customerCode: 'KH001',
                  customerName: 'Cửa hàng Minh Tâm',
                  requestedDeliveryDate: '2026-08-04',
                  collectionPolicy: 'NO_COLLECTION',
                  assignedAt: '2026-08-04T01:30:00.000Z',
                },
              ],
            },
            {
              id: '60000000-0000-4000-8000-000000000002',
              sequence: 2,
              customerId: '70000000-0000-4000-8000-000000000002',
              customerAddressId: '80000000-0000-4000-8000-000000000002',
              address: { line1: '45 Lê Văn Sỹ', districtName: 'Quận 3', provinceName: 'TP.HCM' },
              plannedArrivalAt: null,
              assignments: [
                {
                  assignmentId: '90000000-0000-4000-8000-000000000002',
                  deliveryOrderId: '91000000-0000-4000-8000-000000000002',
                  deliveryOrderNumber: 'DO-0002',
                  salesOrderId: '92000000-0000-4000-8000-000000000002',
                  customerCode: 'KH002',
                  customerName: 'Tạp hóa An Phú',
                  requestedDeliveryDate: '2026-08-04',
                  collectionPolicy: 'NO_COLLECTION',
                  assignedAt: '2026-08-04T01:31:00.000Z',
                },
              ],
            },
          ],
        },
      },
    });
    return;
  }
  json(res, 404, { error: { code: 'NOT_FOUND' } });
});

server.listen(4010, '127.0.0.1', () => {
  console.log('delivery mock core ready');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
