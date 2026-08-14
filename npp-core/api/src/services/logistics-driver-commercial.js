import * as repository from '../db/repositories/logistics-driver-commercial.js';
import { getAssignedDriverTrip } from './logistics-driver-delivery.js';

function commercialLineMap(lines) {
  return new Map(
    (Array.isArray(lines) ? lines : []).map((line) => [String(line.inventoryIssueLineId), line]),
  );
}

function enrichAssignment(assignment, commercial) {
  if (!commercial) {
    return Object.freeze({
      ...assignment,
      currencyCode: null,
      totalAmount: null,
    });
  }
  const lineMap = commercialLineMap(commercial.lines);
  return Object.freeze({
    ...assignment,
    currencyCode: commercial.currency_code ?? null,
    totalAmount: commercial.total_amount ?? null,
    lines: Object.freeze(assignment.lines.map((line) => {
      const priced = lineMap.get(String(line.inventoryIssueLineId));
      return Object.freeze({
        ...line,
        issuedUnitQuantity: priced?.issuedUnitQuantity ?? null,
        unitPrice: priced?.unitPrice ?? null,
        lineAmount: priced?.lineAmount ?? null,
      });
    })),
  });
}

export async function getAssignedDriverTripCommercial(adapter, { requestContext, tripId }) {
  const base = await getAssignedDriverTrip(adapter, { requestContext, tripId });
  if (!base.ok) return base;

  try {
    const rows = await repository.listDriverTripAssignmentCommercial(adapter, {
      installationId: requestContext.installationId,
      tripId,
    });
    const commercialByAssignment = new Map(
      rows.map((row) => [String(row.assignment_id), row]),
    );
    const stops = Object.freeze((base.trip.stops ?? []).map((stop) => Object.freeze({
      ...stop,
      assignments: Object.freeze(stop.assignments.map((assignment) => enrichAssignment(
        assignment,
        commercialByAssignment.get(String(assignment.assignmentId)),
      ))),
    })));
    return Object.freeze({
      ...base,
      trip: Object.freeze({ ...base.trip, stops }),
    });
  } catch {
    return Object.freeze({
      ok: false,
      code: 'DELIVERY_DRIVER_COMMERCIAL_QUERY_FAILED',
      message: 'Delivery commercial details are temporarily unavailable',
      retryable: true,
      details: {},
    });
  }
}
