import * as employeeRepository from '../db/repositories/employee.js';
import * as logisticsRepository from '../db/repositories/logistics-trip-planning.js';
import {
  createDriverProfile as createDriverProfileBase,
  getDeliveryTrip,
  listDriverProfiles as listDriverProfilesBase,
  lockDeliveryTrip as lockDeliveryTripBase,
  planDeliveryTrip as planDeliveryTripBase,
} from './logistics-trip-planning.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(code, message, retryable = false, details = {}) {
  return Object.freeze({ ok: false, code, message, retryable, details });
}

function employeeCandidate(row) {
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

async function activeEmployees(adapter, requestContext, limit = 1000, offset = 0) {
  return employeeRepository.listEmployeesForInstallation(adapter, {
    installationId: requestContext.installationId,
    active: true,
    branchId: null,
    limit,
    offset,
  });
}

async function activeEmployeeById(adapter, requestContext, employeeId) {
  if (!UUID_PATTERN.test(String(employeeId ?? ''))) return null;
  const employee = await employeeRepository.getEmployeeByIdForInstallationForShare(adapter, {
    id: employeeId,
    installationId: requestContext.installationId,
  });
  return employee?.is_active ? employee : null;
}

async function activeDriverByEmployee(adapter, requestContext, employeeId) {
  const rows = await logisticsRepository.listDrivers(adapter, {
    installationId: requestContext.installationId,
    active: true,
    limit: 1000,
    offset: 0,
  });
  return rows.find((row) => row.employee_id === employeeId) ?? null;
}

async function validateTripDriverEmployee(adapter, requestContext, tripId) {
  const detail = await getDeliveryTrip(adapter, { requestContext, tripId });
  if (!detail.ok) return detail;
  const driverId = detail.trip.primaryDriverId;
  if (!driverId) return failure('DRIVER_EMPLOYEE_NOT_AVAILABLE', 'Trip driver must be linked to an active employee');

  const driverRows = await logisticsRepository.listDrivers(adapter, {
    installationId: requestContext.installationId,
    active: true,
    limit: 1000,
    offset: 0,
  });
  const driver = driverRows.find((row) => row.id === driverId);
  if (!driver?.employee_id) {
    return failure('DRIVER_EMPLOYEE_NOT_AVAILABLE', 'Trip driver must be linked to an active employee');
  }
  const employee = await activeEmployeeById(adapter, requestContext, driver.employee_id);
  if (!employee) return failure('DRIVER_EMPLOYEE_NOT_AVAILABLE', 'Trip driver employee is inactive or unavailable');
  return Object.freeze({ ok: true, driver, employee });
}

export async function listDriverEmployees(adapter, { requestContext, limit = 1000, offset = 0 }) {
  const employees = await activeEmployees(adapter, requestContext, limit, offset);
  const drivers = await logisticsRepository.listDrivers(adapter, {
    installationId: requestContext.installationId,
    active: true,
    limit: 1000,
    offset: 0,
  });
  const linkedEmployeeIds = new Set(drivers.map((driver) => driver.employee_id).filter(Boolean));
  return Object.freeze({
    ok: true,
    employees: Object.freeze(employees
      .filter((employee) => !linkedEmployeeIds.has(employee.id))
      .map(employeeCandidate)),
  });
}

export async function listDriverProfiles(adapter, args) {
  const result = await listDriverProfilesBase(adapter, args);
  if (!result.ok || args.active !== true) return result;
  const employees = await activeEmployees(adapter, args.requestContext, 10000, 0);
  const activeEmployeeIds = new Set(employees.map((employee) => employee.id));
  return Object.freeze({
    ...result,
    drivers: Object.freeze(result.drivers.filter((driver) => driver.employeeId && activeEmployeeIds.has(driver.employeeId))),
  });
}

export async function createDriverProfile({ adapter, requestContext, payload }) {
  const employeeId = typeof payload?.employeeId === 'string' ? payload.employeeId : '';
  if (!UUID_PATTERN.test(employeeId)) {
    return failure('INVALID_DRIVER_PROFILE', 'Driver profile requires a valid employee');
  }
  const employee = await activeEmployeeById(adapter, requestContext, employeeId);
  if (!employee) return failure('DRIVER_EMPLOYEE_NOT_AVAILABLE', 'Employee is inactive or unavailable');
  const linked = await activeDriverByEmployee(adapter, requestContext, employeeId);
  if (linked) return failure('DRIVER_EMPLOYEE_ALREADY_LINKED', 'Employee already has an active driver profile');

  const canonicalPayload = {
    employeeId,
    code: employee.code,
    name: employee.full_name,
    phone: employee.phone ?? null,
    licenseReference: payload?.licenseReference ?? null,
  };
  const result = await createDriverProfileBase({ adapter, requestContext, payload: canonicalPayload });
  if (result.ok || result.code !== 'LOGISTICS_MASTER_TRANSACTION_FAILED') return result;

  // Resolve races/DB guards back to a stable business error instead of leaking a retryable 503.
  const employeeAfter = await activeEmployeeById(adapter, requestContext, employeeId);
  if (!employeeAfter) return failure('DRIVER_EMPLOYEE_NOT_AVAILABLE', 'Employee is inactive or unavailable');
  const linkedAfter = await activeDriverByEmployee(adapter, requestContext, employeeId);
  if (linkedAfter) return failure('DRIVER_EMPLOYEE_ALREADY_LINKED', 'Employee already has an active driver profile');
  return result;
}

async function transitionWithDriverEmployee(baseTransition, args) {
  const validation = await validateTripDriverEmployee(args.adapter, args.requestContext, args.tripId);
  if (!validation.ok) return validation;
  const result = await baseTransition(args);
  if (result.ok || result.code !== 'DELIVERY_TRIP_TRANSACTION_FAILED') return result;
  const after = await validateTripDriverEmployee(args.adapter, args.requestContext, args.tripId);
  return after.ok ? result : after;
}

export function planDeliveryTrip(args) {
  return transitionWithDriverEmployee(planDeliveryTripBase, args);
}

export function lockDeliveryTrip(args) {
  return transitionWithDriverEmployee(lockDeliveryTripBase, args);
}
