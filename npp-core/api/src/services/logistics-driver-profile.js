import { randomUUID } from 'node:crypto';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as employeeRepository from '../db/repositories/employee.js';
import * as planningRepository from '../db/repositories/logistics-trip-planning.js';
import * as driverRepository from '../db/repositories/logistics-driver-profile.js';
import {
  getDeliveryTrip,
  planDeliveryTrip as planDeliveryTripBase,
  lockDeliveryTrip as lockDeliveryTripBase,
} from './logistics-trip-planning.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function trimText(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length <= max ? text : undefined;
}

function mapDriver(row) {
  return Object.freeze({
    id: row.id,
    code: row.employee_code ?? row.code,
    employeeId: row.employee_id ?? null,
    name: row.employee_name ?? row.name,
    phone: row.employee_phone ?? row.phone ?? null,
    licenseReference: row.license_reference ?? null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapEmployee(row) {
  return Object.freeze({
    id: row.id,
    code: row.code,
    fullName: row.full_name,
    jobTitle: row.job_title ?? null,
    phone: row.phone ?? null,
    branchId: row.branch_id ?? null,
    isActive: Boolean(row.is_active),
  });
}

async function validateTripDriver(adapter, { requestContext, tripId }) {
  const tripResult = await getDeliveryTrip(adapter, { requestContext, tripId });
  if (!tripResult.ok) return tripResult;
  const driverId = tripResult.trip.primaryDriverId;
  if (!driverId) return failure('DRIVER_EMPLOYEE_NOT_AVAILABLE', 'Trip driver must be linked to an active employee');
  const driver = await driverRepository.getDriverWithEmployee(adapter, {
    installationId: requestContext.installationId,
    driverId,
  });
  if (!driver || !driver.is_active || !driver.employee_id || driver.employee_is_active !== true) {
    return failure('DRIVER_EMPLOYEE_NOT_AVAILABLE', 'Trip driver must be linked to an active employee');
  }
  return Object.freeze({ ok: true });
}

export async function listDriverEmployees(adapter, { requestContext, limit = 1000, offset = 0 }) {
  const rows = await driverRepository.listAvailableDriverEmployees(adapter, {
    installationId: requestContext.installationId,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, employees: Object.freeze(rows.map(mapEmployee)) });
}

export async function listDriverProfiles(adapter, { requestContext, active = null, limit = 200, offset = 0 }) {
  const rows = await driverRepository.listDriverProfiles(adapter, {
    installationId: requestContext.installationId,
    active,
    limit,
    offset,
  });
  return Object.freeze({ ok: true, drivers: Object.freeze(rows.map(mapDriver)) });
}

export async function createDriverProfile({ adapter, requestContext, payload }) {
  const employeeId = typeof payload?.employeeId === 'string' && UUID_PATTERN.test(payload.employeeId)
    ? payload.employeeId
    : null;
  const licenseReference = trimText(payload?.licenseReference, 128);
  if (!employeeId || licenseReference === undefined) {
    return failure('INVALID_DRIVER_PROFILE', 'A canonical employee is required for the driver profile');
  }

  try {
    const result = await withAuditOutboxTransaction({
      adapter,
      mutate: async (client) => {
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${requestContext.installationId}:driver:${employeeId}`],
        );
        const employee = await employeeRepository.getEmployeeByIdForInstallationForShare(client, {
          id: employeeId,
          installationId: requestContext.installationId,
        });
        if (!employee || !employee.is_active) {
          return Object.freeze({ failed: true, result: failure('DRIVER_EMPLOYEE_NOT_AVAILABLE', 'Employee is inactive or outside this installation') });
        }
        const duplicate = await driverRepository.findActiveDriverByEmployee(client, {
          installationId: requestContext.installationId,
          employeeId,
        });
        if (duplicate) {
          return Object.freeze({ failed: true, result: failure('DRIVER_EMPLOYEE_ALREADY_LINKED', 'Employee already has an active driver profile') });
        }

        const row = await planningRepository.insertDriver(client, {
          id: randomUUID(),
          installationId: requestContext.installationId,
          code: employee.code,
          employeeId: employee.id,
          name: employee.full_name,
          phone: employee.phone,
          licenseReference,
          actorId: requestContext.actorId,
        });
        const driver = mapDriver({
          ...row,
          employee_code: employee.code,
          employee_name: employee.full_name,
          employee_phone: employee.phone,
        });
        const action = 'core.driver_profile.created';
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action,
          resourceType: 'driver_profile',
          resourceId: driver.id,
          afterData: driver,
          metadata: { employeeId },
        }));
        const outbox = buildOutboxEvent({
          requestContext,
          aggregateType: 'logistics.driver_profile',
          aggregateId: driver.id,
          eventType: action,
          payload: driver,
          metadata: { employeeId },
        });
        await insertOutboxEvent(client, outbox);
        return Object.freeze({ driver, eventId: outbox.eventId });
      },
    });
    if (result?.failed) return result.result;
    return Object.freeze({ ok: true, driver_profile: result.driver });
  } catch (error) {
    if (error?.code === '23503') {
      return failure('DRIVER_EMPLOYEE_NOT_AVAILABLE', 'Employee is inactive or outside this installation');
    }
    if (error?.code === '23505') {
      return failure('DRIVER_PROFILE_CODE_CONFLICT', 'Canonical employee code conflicts with another driver profile');
    }
    return failure('LOGISTICS_MASTER_TRANSACTION_FAILED', 'Logistics master transaction failed', true);
  }
}

export async function planDeliveryTrip(args) {
  const driverValidation = await validateTripDriver(args.adapter, args);
  if (!driverValidation.ok) return driverValidation;
  return planDeliveryTripBase(args);
}

export async function lockDeliveryTrip(args) {
  const driverValidation = await validateTripDriver(args.adapter, args);
  if (!driverValidation.ok) return driverValidation;
  return lockDeliveryTripBase(args);
}
