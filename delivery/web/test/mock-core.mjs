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
const collections = new Map();
const handovers = [];
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
    customerId: '70000000-0000-4000-8000-000000000001',
    customerCode: 'KH001',
    customerName: 'Cửa hàng Minh Tâm',
    requestedDeliveryDate: '2026-08-04',
    collectionPolicy: 'COLLECT_ON_DELIVERY',
    amountDue: '300000.000000',
    assignedAt: '2026-08-04T01:30:00.000Z',
    dispatchItemId: '94000000-0000-4000-8000-000000000001',
    inventoryIssueId: '95000000-0000-4000-8000-000000000001',
    lines: [{
      deliveryOrderLineId: '96000000-0000-4000-8000-000000000001',
      inventoryIssueLineId: issueLineOneId,
      sku: 'BOT-01', itemName: 'Bột nguyên liệu A', unitCode: 'BAO', issuedBaseQuantity: '3.000000000000',
    }],
  }],
  [assignmentTwoId, {
    assignmentId: assignmentTwoId,
    deliveryOrderId: '91000000-0000-4000-8000-000000000002',
    deliveryOrderNumber: 'DO-0002',
    salesOrderId: '92000000-0000-4000-8000-000000000002',
    customerId: '70000000-0000-4000-8000-000000000002',
    customerCode: 'KH002', customerName: 'Tạp hóa An Phú', requestedDeliveryDate: '2026-08-04',
    collectionPolicy: 'NO_COLLECTION', amountDue: null,
    assignedAt: '2026-08-04T01:31:00.000Z',
    dispatchItemId: '94000000-0000-4000-8000-000000000002',
    inventoryIssueId: '95000000-0000-4000-8000-000000000002',
    lines: [{
      deliveryOrderLineId: '96000000-0000-4000-8000-000000000002',
      inventoryIssueLineId: issueLineTwoId,
      sku: 'BOT-02', itemName: 'Bột nguyên liệu B', unitCode: 'BAO', issuedBaseQuantity: '2.000000000000',
    }],
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
      id: attempt.id, result: attempt.result, attemptedAt: attempt.attemptedAt,
      reasonCode: attempt.reasonCode, note: attempt.note, rescheduledFor: attempt.rescheduledFor,
    } : null,
    lines: fixture.lines.map((line) => ({
      ...line,
      deliveredBaseQuantity: attempt?.lines.find((candidate) => candidate.inventoryIssueLineId === line.inventoryIssueLineId)?.deliveredBaseQuantity ?? null,
    })),
  };
}

function detailTrip() {
  return {
    ...baseTrip,
    attemptCount: attempts.size,
    stops: [
      {
        id: '60000000-0000-4000-8000-000000000001', sequence: 1,
        customerId: '70000000-0000-4000-8000-000000000001', customerAddressId: '80000000-0000-4000-8000-000000000001',
        address: { line1: '12 Nguyễn Trãi', districtName: 'Quận 5', provinceName: 'TP.HCM' }, plannedArrivalAt: null,
        assignments: [assignmentView(assignmentOneId)],
      },
      {
        id: '60000000-0000-4000-8000-000000000002', sequence: 2,
        customerId: '70000000-0000-4000-8000-000000000002', customerAddressId: '80000000-0000-4000-8000-000000000002',
        address: { line1: '45 Lê Văn Sỹ', districtName: 'Quận 3', provinceName: 'TP.HCM' }, plannedArrivalAt: null,
        assignments: [assignmentView(assignmentTwoId)],
      },
    ],
  };
}

function attemptLines(fixture, payload) {
  if (payload.result === 'delivered_full') return fixture.lines.map((line) => ({ id: randomUUID(), ...line, deliveredBaseQuantity: line.issuedBaseQuantity }));
  if (payload.result === 'delivered_partial') return fixture.lines.map((line) => ({
    id: randomUUID(), ...line,
    deliveredBaseQuantity: payload.lines.find((candidate) => candidate.inventoryIssueLineId === line.inventoryIssueLineId)?.deliveredBaseQuantity ?? '0.000000000000',
  }));
  return [];
}

function collectionView(collection) {
  if (!collection) return null;
  const activeHanded = handovers
    .filter((handover) => handover.status !== 'reversed')
    .flatMap((handover) => handover.lines)
    .filter((line) => line.collectionId === collection.id)
    .reduce((sum, line) => sum + Number(line.handedOverAmount), 0);
  return {
    ...collection,
    handedOverAmount: activeHanded.toFixed(6),
    custodyRemainingAmount: collection.collectionMethod === 'CASH'
      ? Math.max(Number(collection.receivedAmount) - activeHanded, 0).toFixed(6)
      : '0.000000',
  };
}

function codOverview() {
  const assignments = [...assignmentFixtures.values()].map((fixture, index) => {
    const attempt = attempts.get(fixture.assignmentId);
    return {
      assignmentId: fixture.assignmentId,
      stopId: index === 0 ? '60000000-0000-4000-8000-000000000001' : '60000000-0000-4000-8000-000000000002',
      stopSequence: index + 1,
      deliveryOrderId: fixture.deliveryOrderId,
      deliveryOrderNumber: fixture.deliveryOrderNumber,
      customerId: fixture.customerId,
      customerCode: fixture.customerCode,
      customerName: fixture.customerName,
      collectionPolicy: fixture.collectionPolicy,
      deliveryAttemptId: attempt?.id ?? null,
      deliveryAttemptResult: attempt?.result ?? null,
      receivableDocumentId: attempt ? `a${fixture.assignmentId.slice(1)}` : null,
      receivableDocumentNumber: attempt ? `AR-${fixture.deliveryOrderNumber}` : null,
      currencyCode: attempt ? 'VND' : null,
      amountDue: attempt && fixture.collectionPolicy === 'COLLECT_ON_DELIVERY' ? fixture.amountDue : null,
      collection: collectionView(collections.get(fixture.assignmentId)),
    };
  });
  const custodyTotal = assignments.reduce((sum, item) => sum + Number(item.collection?.custodyRemainingAmount ?? 0), 0);
  return {
    trip: {
      id: tripId, number: baseTrip.number, warehouseId: baseTrip.warehouseId,
      warehouseCode: baseTrip.warehouseCode, warehouseName: baseTrip.warehouseName,
      driverProfileId: baseTrip.primaryDriverId, driverCode: baseTrip.driverCode,
      driverName: baseTrip.driverName, custodyTotal: custodyTotal.toFixed(6),
    },
    assignments,
    handovers,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}` || req.headers['x-npp-delivery-employee-id'] !== employeeId) {
    json(res, 401, { error: { code: 'UNAUTHORIZED' } });
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1:4010');
  if (req.method === 'GET' && url.pathname === '/api/logistics/driver/trips') {
    json(res, 200, { data: { driver: { id: baseTrip.primaryDriverId, code: 'TX-01', name: baseTrip.driverName, employeeId }, trips: [{ ...baseTrip, attemptCount: attempts.size }] } });
    return;
  }
  if (req.method === 'GET' && url.pathname === `/api/logistics/driver/trips/${tripId}`) {
    json(res, 200, { data: { driver: { id: baseTrip.primaryDriverId, code: 'TX-01', name: baseTrip.driverName, employeeId }, trip: detailTrip() } });
    return;
  }
  if (req.method === 'GET' && url.pathname === `/api/logistics/driver/trips/${tripId}/cod`) {
    json(res, 200, { data: codOverview() });
    return;
  }

  const attemptMatch = url.pathname.match(new RegExp(`^/api/logistics/driver/trips/${tripId}/assignments/([^/]+)/attempts$`));
  if (req.method === 'POST' && attemptMatch) {
    const assignmentId = attemptMatch[1];
    const fixture = assignmentFixtures.get(assignmentId);
    const key = String(req.headers['idempotency-key'] || '');
    if (!fixture || !key) { json(res, 400, { error: { code: 'INVALID_ATTEMPT_REQUEST', message: 'Yêu cầu không hợp lệ' } }); return; }
    const payload = await readJson(req);
    const signature = JSON.stringify(payload);
    const replay = idempotency.get(key);
    if (replay) {
      if (replay.signature !== signature || replay.assignmentId !== assignmentId) { json(res, 409, { error: { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH', message: 'Khóa đã dùng cho dữ liệu khác' } }); return; }
      json(res, 200, { data: { ok: true, attempt: replay.attempt, replayed: true } }); return;
    }
    if (attempts.has(assignmentId)) { json(res, 409, { error: { code: 'DELIVERY_ATTEMPT_ALREADY_RECORDED', message: 'Phiếu đã có kết quả' } }); return; }
    const attempt = {
      id: randomUUID(), tripId,
      stopId: assignmentId === assignmentOneId ? '60000000-0000-4000-8000-000000000001' : '60000000-0000-4000-8000-000000000002',
      assignmentId, deliveryOrderId: fixture.deliveryOrderId, driverProfileId: baseTrip.primaryDriverId,
      result: payload.result, attemptedAt: payload.attemptedAt, reasonCode: payload.reasonCode ?? null,
      note: payload.note ?? null, rescheduledFor: payload.rescheduledFor ?? null,
      lines: attemptLines(fixture, payload),
    };
    attempts.set(assignmentId, attempt);
    idempotency.set(key, { assignmentId, signature, attempt });
    json(res, 200, { data: { ok: true, attempt, replayed: false, eventId: randomUUID() } }); return;
  }

  const collectionMatch = url.pathname.match(new RegExp(`^/api/logistics/driver/trips/${tripId}/assignments/([^/]+)/cod-collections$`));
  if (req.method === 'POST' && collectionMatch) {
    const assignmentId = collectionMatch[1];
    const fixture = assignmentFixtures.get(assignmentId);
    const key = String(req.headers['idempotency-key'] || '');
    const payload = await readJson(req);
    if (!fixture || !attempts.has(assignmentId) || !key) { json(res, 400, { error: { code: 'INVALID_COD_COLLECTION', message: 'Yêu cầu thu COD không hợp lệ' } }); return; }
    const replay = idempotency.get(key);
    if (replay) { json(res, 200, { data: replay.data }); return; }
    const expected = Number(fixture.amountDue ?? 0);
    const received = payload.collectionMethod === 'NONE' ? 0 : Number(payload.receivedAmount);
    const collection = {
      id: randomUUID(), assignmentId, deliveryAttemptId: attempts.get(assignmentId).id,
      deliveryOrderId: fixture.deliveryOrderId, customerId: fixture.customerId,
      sourceReceivableDocumentId: `a${assignmentId.slice(1)}`,
      paymentDocumentId: payload.collectionMethod === 'NONE' ? null : randomUUID(),
      paymentDocumentNumber: payload.collectionMethod === 'NONE' ? null : 'CP-202608-000001',
      collectionMethod: payload.collectionMethod,
      collectionStatus: payload.collectionMethod === 'NONE' ? 'not_collected' : received === expected ? 'collected_full' : received < expected ? 'collected_partial' : 'collected_excess',
      currencyCode: 'VND', expectedAmount: expected.toFixed(6), receivedAmount: received.toFixed(6),
      externalReference: payload.externalReference ?? null, reasonCode: payload.reasonCode ?? null,
      promisedBy: payload.promisedBy ?? null, dueAt: payload.dueAt ?? null, note: payload.note ?? null,
      collectedAt: payload.collectedAt, reversed: false, reversalReason: null,
    };
    collections.set(assignmentId, collection);
    const data = { ok: true, collection: collectionView(collection), replayed: false, eventId: randomUUID() };
    idempotency.set(key, { data });
    json(res, 200, { data }); return;
  }

  if (req.method === 'POST' && url.pathname === `/api/logistics/driver/trips/${tripId}/cod-handovers`) {
    const key = String(req.headers['idempotency-key'] || '');
    const payload = await readJson(req);
    if (!key || !Array.isArray(payload.lines) || !payload.lines.length) { json(res, 400, { error: { code: 'INVALID_COD_HANDOVER', message: 'Bàn giao không hợp lệ' } }); return; }
    const replay = idempotency.get(key);
    if (replay) { json(res, 200, { data: replay.data }); return; }
    const expectedTotal = payload.lines.reduce((sum, line) => {
      const collection = [...collections.values()].find((item) => item.id === line.collectionId);
      return sum + Number(collectionView(collection)?.custodyRemainingAmount ?? 0);
    }, 0);
    const handedOverTotal = payload.lines.reduce((sum, line) => sum + Number(line.amount), 0);
    const excess = Number(payload.unattributedExcessAmount ?? 0);
    const handover = {
      id: randomUUID(), tripId, tripNumber: baseTrip.number,
      expectedTotal: expectedTotal.toFixed(6), handedOverTotal: handedOverTotal.toFixed(6),
      unattributedExcessAmount: excess.toFixed(6), differenceAmount: (handedOverTotal + excess - expectedTotal).toFixed(6),
      reason: payload.reason ?? null, note: payload.note ?? null, handedOverAt: payload.handedOverAt,
      status: 'submitted', lines: payload.lines.map((line) => {
        const collection = [...collections.values()].find((item) => item.id === line.collectionId);
        const fixture = assignmentFixtures.get(collection.assignmentId);
        return { id: randomUUID(), collectionId: line.collectionId, expectedAmount: collectionView(collection).custodyRemainingAmount, handedOverAmount: Number(line.amount).toFixed(6), customerCode: fixture.customerCode, customerName: fixture.customerName, deliveryOrderNumber: fixture.deliveryOrderNumber };
      }),
    };
    handovers.unshift(handover);
    const data = { ok: true, handover, replayed: false, eventId: randomUUID() };
    idempotency.set(key, { data });
    json(res, 200, { data }); return;
  }

  json(res, 404, { error: { code: 'NOT_FOUND' } });
});

server.listen(4010, '127.0.0.1', () => console.log('delivery mock core ready'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
