import http from 'node:http';
import { randomUUID } from 'node:crypto';

const employeeId = '10000000-0000-4000-8000-000000000001';
const tripId = '30000000-0000-4000-8000-000000000001';
const token = 'delivery-core-test-token-000000';
const assignmentOneId = '90000000-0000-4000-8000-000000000001';
const assignmentTwoId = '90000000-0000-4000-8000-000000000002';
const issueLineOneId = '93000000-0000-4000-8000-000000000001';
const issueLineTwoId = '93000000-0000-4000-8000-000000000002';
const attempts = new Map();
const idempotency = new Map();

const baseTrip = {
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

const assignmentFixtures = new Map([
  [assignmentOneId, {
    assignmentId: assignmentOneId,
    deliveryOrderId: '91000000-0000-4000-8000-000000000001',
    deliveryOrderNumber: 'DO-0001',
    salesOrderId: '92000000-0000-4000-8000-000000000001',
    customerCode: 'KH001',
    customerName: 'Cửa hàng Minh Tâm',
    requestedDeliveryDate: '2026-08-04',
    collectionPolicy: 'NO_COLLECTION',
    assignedAt: '2026-08-04T01:30:00.000Z',
    dispatchItemId: '94000000-0000-4000-8000-000000000001',
    inventoryIssueId: '95000000-0000-4000-8000-000000000001',
    lines: [
      {
        deliveryOrderLineId: '96000000-0000-4000-8000-000000000001',
        inventoryIssueLineId: issueLineOneId,
        sku: 'BOT-01',
        itemName: 'Bột nguyên liệu A',
        unitCode: 'BAO',
        issuedBaseQuantity: '3.000000000000',
      },
    ],
  }],
  [assignmentTwoId, {
    assignmentId: assignmentTwoId,
    deliveryOrderId: '91000000-0000-4000-8000-000000000002',
    deliveryOrderNumber: 'DO-0002',
    salesOrderId: '92000000-0000-4000-8000-000000000002',
    customerCode: 'KH002',
    customerName: 'Tạp hóa An Phú',
    requestedDeliveryDate: '2026-08-04',
    collectionPolicy: 'NO_COLLECTION',
    assignedAt: '2026-08-04T01:31:00.000Z',
    dispatchItemId: '94000000-0000-4000-8000-000000000002',
    inventoryIssueId: '95000000-0000-4000-8000-000000000002',
    lines: [
      {
        deliveryOrderLineId: '96000000-0000-4000-8000-000000000002',
        inventoryIssueLineId: issueLineTwoId,
        sku: 'BOT-02',
        itemName: 'Bột nguyên liệu B',
        unitCode: 'BAO',
        issuedBaseQuantity: '2.000000000000',
      },
    ],
  }],
]);

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function assignmentView(assignmentId) {
  const fixture = assignmentFixtures.get(assignmentId);
  const attempt = attempts.get(assignmentId) ?? null;
  return {
    ...fixture,
    attempt: attempt ? {
      id: attempt.id,
      result: attempt.result,
      attemptedAt: attempt.attemptedAt,
      reasonCode: attempt.reasonCode,
      note: attempt.note,
      rescheduledFor: attempt.rescheduledFor,
    } : null,
    lines: fixture.lines.map((line) => ({
      ...line,
      deliveredBaseQuantity: attempt?.lines.find(
        (attemptLine) => attemptLine.inventoryIssueLineId === line.inventoryIssueLineId,
      )?.deliveredBaseQuantity ?? null,
    })),
  };
}

function detailTrip() {
  return {
    ...baseTrip,
    attemptCount: attempts.size,
    stops: [
      {
        id: '60000000-0000-4000-8000-000000000001',
        sequence: 1,
        customerId: '70000000-0000-4000-8000-000000000001',
        customerAddressId: '80000000-0000-4000-8000-000000000001',
        address: { line1: '12 Nguyễn Trãi', districtName: 'Quận 5', provinceName: 'TP.HCM' },
        plannedArrivalAt: null,
        assignments: [assignmentView(assignmentOneId)],
      },
      {
        id: '60000000-0000-4000-8000-000000000002',
        sequence: 2,
        customerId: '70000000-0000-4000-8000-000000000002',
        customerAddressId: '80000000-0000-4000-8000-000000000002',
        address: { line1: '45 Lê Văn Sỹ', districtName: 'Quận 3', provinceName: 'TP.HCM' },
        plannedArrivalAt: null,
        assignments: [assignmentView(assignmentTwoId)],
      },
    ],
  };
}

function attemptLines(fixture, payload) {
  if (payload.result === 'delivered_full') {
    return fixture.lines.map((line) => ({
      id: randomUUID(),
      ...line,
      deliveredBaseQuantity: line.issuedBaseQuantity,
    }));
  }
  if (payload.result === 'delivered_partial') {
    return fixture.lines.map((line) => ({
      id: randomUUID(),
      ...line,
      deliveredBaseQuantity: payload.lines.find(
        (candidate) => candidate.inventoryIssueLineId === line.inventoryIssueLineId,
      )?.deliveredBaseQuantity ?? '0.000000000000',
    }));
  }
  return [];
}

const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`
      || req.headers['x-npp-delivery-employee-id'] !== employeeId) {
    json(res, 401, { error: { code: 'UNAUTHORIZED' } });
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1:4010');
  if (req.method === 'GET' && url.pathname === '/api/logistics/driver/trips') {
    json(res, 200, {
      data: {
        driver: { id: baseTrip.primaryDriverId, code: 'TX-01', name: baseTrip.driverName, employeeId },
        trips: [{ ...baseTrip, attemptCount: attempts.size }],
      },
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === `/api/logistics/driver/trips/${tripId}`) {
    json(res, 200, {
      data: {
        driver: { id: baseTrip.primaryDriverId, code: 'TX-01', name: baseTrip.driverName, employeeId },
        trip: detailTrip(),
      },
    });
    return;
  }

  const attemptMatch = url.pathname.match(
    new RegExp(`^/api/logistics/driver/trips/${tripId}/assignments/([^/]+)/attempts$`),
  );
  if (req.method === 'POST' && attemptMatch) {
    const assignmentId = attemptMatch[1];
    const fixture = assignmentFixtures.get(assignmentId);
    const key = String(req.headers['idempotency-key'] || '');
    if (!fixture || !key) {
      json(res, 400, { error: { code: 'INVALID_ATTEMPT_REQUEST', message: 'Yêu cầu không hợp lệ' } });
      return;
    }
    const payload = await readJson(req);
    const signature = JSON.stringify(payload);
    const replay = idempotency.get(key);
    if (replay) {
      if (replay.signature !== signature || replay.assignmentId !== assignmentId) {
        json(res, 409, { error: { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH', message: 'Khóa đã dùng cho dữ liệu khác' } });
        return;
      }
      json(res, 200, { data: { ok: true, attempt: replay.attempt, replayed: true } });
      return;
    }
    if (attempts.has(assignmentId)) {
      json(res, 409, { error: { code: 'DELIVERY_ATTEMPT_ALREADY_RECORDED', message: 'Phiếu đã có kết quả' } });
      return;
    }
    const attempt = {
      id: randomUUID(),
      tripId,
      stopId: assignmentId === assignmentOneId
        ? '60000000-0000-4000-8000-000000000001'
        : '60000000-0000-4000-8000-000000000002',
      assignmentId,
      deliveryOrderId: fixture.deliveryOrderId,
      driverProfileId: baseTrip.primaryDriverId,
      result: payload.result,
      attemptedAt: payload.attemptedAt,
      reasonCode: payload.reasonCode ?? null,
      note: payload.note ?? null,
      rescheduledFor: payload.rescheduledFor ?? null,
      lines: attemptLines(fixture, payload),
    };
    attempts.set(assignmentId, attempt);
    idempotency.set(key, { assignmentId, signature, attempt });
    json(res, 200, { data: { ok: true, attempt, replayed: false, eventId: randomUUID() } });
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
