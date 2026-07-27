import * as supplierRepo from '../db/repositories/supplier.js';
import * as employeeRepo from '../db/repositories/employee.js';

const CODE_PATTERN = /^[A-Z0-9_-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCode(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeOptionalUuid(value) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeText(value);
}

function isValidUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function validatePhone(value) {
  return !value || /^[0-9\s\-+()]{5,20}$/.test(value);
}

function normalizeDateTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function validateExpectedUpdatedAt(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: false, code: 'MISSING_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt is required' };
  }
  const normalized = normalizeDateTime(value);
  if (!normalized) {
    return { ok: false, code: 'INVALID_EXPECTED_UPDATED_AT', message: 'expectedUpdatedAt must be a valid date-time' };
  }
  return { ok: true, value: normalized };
}

function conflictResult(message) {
  return { ok: false, code: 'CONFLICT', message, retryable: false };
}

function validateSearch(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const normalized = normalizeText(value);
  if (normalized.length > 256) {
    return { ok: false, code: 'INVALID_SEARCH', message: 'Search must not exceed 256 characters' };
  }
  return { ok: true, value: normalized || null };
}

async function resolveEmployee(client, { installationId, employeeId, requireActive }) {
  if (!employeeId) return { ok: true, employee: null };
  const employee = await employeeRepo.getEmployeeByIdForInstallationForShare(client, { id: employeeId, installationId });
  if (!employee) return { ok: false, code: 'EMPLOYEE_NOT_FOUND', message: 'Purchase owner employee was not found' };
  if (requireActive && !employee.is_active) return { ok: false, code: 'EMPLOYEE_INACTIVE', message: 'Purchase owner employee is not active' };
  return { ok: true, employee };
}

export function validateSupplierInput(payload, { codeRequired = true } = {}) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_INPUT', message: 'Supplier data is required' };
  }

  const code = normalizeCode(payload.code);
  if (codeRequired && !CODE_PATTERN.test(code)) {
    return { ok: false, code: 'INVALID_CODE', message: 'Code must contain only uppercase letters, digits, hyphens, or underscores' };
  }

  const name = normalizeText(payload.name);
  if (!name || name.length > 256) {
    return { ok: false, code: 'INVALID_NAME', message: 'Name is required and must not exceed 256 characters' };
  }

  const taxId = normalizeText(payload.taxId);
  if (taxId.length > 64) return { ok: false, code: 'INVALID_TAX_ID', message: 'Tax ID must not exceed 64 characters' };

  const bankAccount = normalizeText(payload.bankAccount);
  if (bankAccount.length > 64) return { ok: false, code: 'INVALID_BANK_ACCOUNT', message: 'Bank account must not exceed 64 characters' };

  const bankName = normalizeText(payload.bankName);
  if (bankName.length > 256) return { ok: false, code: 'INVALID_BANK_NAME', message: 'Bank name must not exceed 256 characters' };

  const avgDeliveryDays = payload.avgDeliveryDays === undefined || payload.avgDeliveryDays === null || payload.avgDeliveryDays === ''
    ? null
    : Number(payload.avgDeliveryDays);
  if (avgDeliveryDays !== null && (!Number.isInteger(avgDeliveryDays) || avgDeliveryDays < 0 || avgDeliveryDays > 3650)) {
    return { ok: false, code: 'INVALID_AVG_DELIVERY_DAYS', message: 'Average delivery days must be an integer from 0 through 3650 days' };
  }

  const purchaseOwnerEmployeeId = normalizeOptionalUuid(payload.purchaseOwnerEmployeeId);
  if (purchaseOwnerEmployeeId && !isValidUuid(purchaseOwnerEmployeeId)) {
    return { ok: false, code: 'INVALID_EMPLOYEE_ID', message: 'Purchase owner employee ID must be a valid UUID' };
  }

  return {
    ok: true,
    normalized: {
      code,
      name,
      taxId: taxId || null,
      bankAccount: bankAccount || null,
      bankName: bankName || null,
      avgDeliveryDays,
      purchaseOwnerEmployeeId,
    },
  };
}

export async function createSupplier(client, { installationId, payload, createdBy }) {
  const validation = validateSupplierInput(payload);
  if (!validation.ok) return validation;

  const existing = await supplierRepo.getSupplierByCode(client, {
    installationId,
    code: validation.normalized.code,
  });
  if (existing) return { ok: false, code: 'DUPLICATE_CODE', message: 'A supplier with this code already exists' };

  const employeeResult = await resolveEmployee(client, {
    installationId,
    employeeId: validation.normalized.purchaseOwnerEmployeeId,
    requireActive: true,
  });
  if (!employeeResult.ok) return employeeResult;

  const supplier = await supplierRepo.insertSupplier(client, {
    installationId,
    ...validation.normalized,
    createdBy,
  });
  if (!supplier) return { ok: false, code: 'DUPLICATE_CODE', message: 'A supplier with this code already exists' };
  return { ok: true, supplier };
}

export async function getSupplier(client, { installationId, id }) {
  if (!isValidUuid(id)) return { ok: false, code: 'NOT_FOUND', message: 'Supplier not found' };
  const supplier = await supplierRepo.getSupplierByIdForInstallation(client, { id: id.trim(), installationId });
  return supplier ? { ok: true, supplier } : { ok: false, code: 'NOT_FOUND', message: 'Supplier not found' };
}

export async function listSuppliers(client, { installationId, search, active, limit, offset }) {
  const searchValidation = validateSearch(search);
  if (!searchValidation.ok) return searchValidation;
  const suppliers = await supplierRepo.listSuppliersForInstallation(client, {
    installationId,
    search: searchValidation.value,
    active,
    limit,
    offset,
  });
  return { ok: true, suppliers };
}

export async function updateSupplier(client, { id, installationId, payload, updatedBy }) {
  if (!isValidUuid(id)) return { ok: false, code: 'INVALID_ID', message: 'Supplier ID must be a valid UUID' };
  const existing = await supplierRepo.getSupplierByIdForInstallationForUpdate(client, { id: id.trim(), installationId });
  if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Supplier not found' };

  const expected = validateExpectedUpdatedAt(payload?.expectedUpdatedAt);
  if (!expected.ok) return expected;
  if (normalizeDateTime(existing.updated_at) !== expected.value) return conflictResult('Supplier update conflict');

  if (typeof payload?.isActive === 'boolean') {
    if (existing.is_active === payload.isActive) {
      const current = await supplierRepo.getSupplierByIdForInstallation(client, { id: existing.id, installationId });
      return { ok: true, supplier: current, beforeData: current, changed: false, action: payload.isActive ? 'activate' : 'deactivate' };
    }
    const supplier = await supplierRepo.updateSupplierActiveStatus(client, {
      id: existing.id,
      installationId,
      isActive: payload.isActive,
      updatedBy,
      expectedUpdatedAt: expected.value,
    });
    if (!supplier) return conflictResult('Supplier status update conflict');
    return { ok: true, supplier, beforeData: existing, changed: true, action: payload.isActive ? 'activate' : 'deactivate' };
  }

  const validation = validateSupplierInput({
    code: existing.code,
    name: payload?.name ?? existing.name,
    taxId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'taxId') ? payload.taxId : existing.tax_id ?? '',
    bankAccount: Object.prototype.hasOwnProperty.call(payload ?? {}, 'bankAccount') ? payload.bankAccount : existing.bank_account ?? '',
    bankName: Object.prototype.hasOwnProperty.call(payload ?? {}, 'bankName') ? payload.bankName : existing.bank_name ?? '',
    avgDeliveryDays: Object.prototype.hasOwnProperty.call(payload ?? {}, 'avgDeliveryDays')
      ? payload.avgDeliveryDays
      : existing.avg_delivery_days,
    purchaseOwnerEmployeeId: Object.prototype.hasOwnProperty.call(payload ?? {}, 'purchaseOwnerEmployeeId')
      ? payload.purchaseOwnerEmployeeId
      : existing.purchase_owner_employee_id,
  });
  if (!validation.ok) return validation;

  const employeeResult = await resolveEmployee(client, {
    installationId,
    employeeId: validation.normalized.purchaseOwnerEmployeeId,
    requireActive: validation.normalized.purchaseOwnerEmployeeId !== existing.purchase_owner_employee_id,
  });
  if (!employeeResult.ok) return employeeResult;

  const supplier = await supplierRepo.updateSupplier(client, {
    id: existing.id,
    installationId,
    ...validation.normalized,
    updatedBy,
    expectedUpdatedAt: expected.value,
  });
  if (!supplier) return conflictResult('Supplier update conflict');
  return { ok: true, supplier, beforeData: existing, changed: true, action: 'update' };
}
