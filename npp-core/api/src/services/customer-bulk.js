import * as customerService from './customer.js';
import { createCustomerCodeAllocator } from './customer-code.js';

const MAX_ROWS = 500;
const MAPPINGS = new Set([
  'CUSTOMER_CODE',
  'NAME',
  'GROUP_CODE',
  'RESPONSIBLE_EMPLOYEE_CODE',
  'PHONE',
  'EMAIL',
  'TAX_CODE',
  'PAYMENT_TERMS_DAYS',
  'CREDIT_LIMIT',
  'NOTES',
  'IGNORE',
]);
const UPDATE_FIELDS = Object.freeze({
  NAME: Object.freeze({ payloadKey: 'name', label: 'Tên khách hàng', currentKey: 'name' }),
  GROUP_CODE: Object.freeze({ payloadKey: 'groupId', label: 'Nhóm khách hàng', currentKey: 'group_code' }),
  RESPONSIBLE_EMPLOYEE_CODE: Object.freeze({ payloadKey: 'responsibleEmployeeId', label: 'Nhân viên phụ trách', currentKey: 'responsible_employee_code' }),
  PHONE: Object.freeze({ payloadKey: 'phone', label: 'Điện thoại', currentKey: 'phone' }),
  EMAIL: Object.freeze({ payloadKey: 'email', label: 'Email', currentKey: 'email' }),
  TAX_CODE: Object.freeze({ payloadKey: 'taxCode', label: 'Mã số thuế', currentKey: 'tax_code' }),
  PAYMENT_TERMS_DAYS: Object.freeze({ payloadKey: 'paymentTermsDays', label: 'Thời hạn thanh toán', currentKey: 'payment_terms_days' }),
  CREDIT_LIMIT: Object.freeze({ payloadKey: 'creditLimit', label: 'Hạn mức tín dụng', currentKey: 'credit_limit' }),
  NOTES: Object.freeze({ payloadKey: 'notes', label: 'Ghi chú', currentKey: 'notes' }),
});

function failure(code, message, details = {}) {
  return { ok: false, code, message, details, retryable: false };
}

function text(value) {
  return String(value ?? '').trim();
}

function code(value) {
  return text(value).toUpperCase();
}

function display(value) {
  if (value === undefined || value === null || value === '') return 'Trống';
  return String(value);
}

function normalizeRows(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) {
    return failure('INVALID_ROWS', 'Danh sách dòng dữ liệu không hợp lệ');
  }
  if (payload.rows.length < 1) return failure('EMPTY_ROWS', 'Không có dòng dữ liệu để xử lý');
  if (payload.rows.length > MAX_ROWS) return failure('TOO_MANY_ROWS', `Mỗi lần chỉ xử lý tối đa ${MAX_ROWS} dòng`);
  const rows = payload.rows.map((row, index) => ({
    rowNumber: Number.isInteger(row?.rowNumber) && row.rowNumber > 0 ? row.rowNumber : index + 1,
    cells: Array.isArray(row?.cells) ? row.cells.map((value) => String(value ?? '')) : [],
    expectedUpdatedAt: typeof row?.expectedUpdatedAt === 'string' ? row.expectedUpdatedAt : null,
  }));
  return { ok: true, rows };
}

function normalizeMappings(payload, mode) {
  if (!Array.isArray(payload?.mappings) || payload.mappings.length < 1) {
    return failure('INVALID_MAPPINGS', 'Cần chọn trường tương ứng cho các cột dữ liệu');
  }
  const mappings = payload.mappings.map((value) => String(value ?? '').trim().toUpperCase());
  if (mappings.some((value) => !MAPPINGS.has(value))) {
    return failure('INVALID_MAPPING', 'Có cột đang chọn trường không được hỗ trợ');
  }
  const used = new Set();
  for (const mapping of mappings) {
    if (mapping === 'IGNORE') continue;
    if (used.has(mapping)) return failure('DUPLICATE_FIELD_MAPPING', 'Một trường chỉ được chọn cho một cột');
    used.add(mapping);
  }
  if (mode === 'update') {
    if (mappings[0] !== 'CUSTOMER_CODE') return failure('CUSTOMER_CODE_QUERY_KEY_REQUIRED', 'Cột 1 phải là Mã khách hàng');
    if (!mappings.slice(1).some((value) => value !== 'IGNORE')) {
      return failure('UPDATE_FIELD_REQUIRED', 'Chọn ít nhất một trường cần cập nhật từ cột 2 trở đi');
    }
  }
  if (mode === 'import' && !used.has('NAME')) {
    return failure('CUSTOMER_NAME_MAPPING_REQUIRED', 'Cần chọn một cột làm Tên khách hàng');
  }
  return { ok: true, mappings };
}

function mappingCell(row, mappings, mapping) {
  const index = mappings.indexOf(mapping);
  if (index < 0 || index >= row.cells.length) return { present: false, value: '' };
  return { present: true, value: row.cells[index] };
}

function isCustomerCodeValid(value) {
  const validation = customerService.validateCustomerInput({ code: value, name: 'Khách hàng' });
  return validation.ok;
}

async function loadCustomersByCodes(client, installationId, codes) {
  if (codes.length === 0) return [];
  const result = await client.query(
    `SELECT c.id, c.installation_id, c.code, c.name, c.group_id,
            c.responsible_employee_id, c.phone, c.email, c.tax_code,
            c.payment_terms_days, c.credit_limit, c.notes, c.is_active,
            c.created_at, c.updated_at, c.created_by, c.updated_by,
            g.code AS group_code, g.name AS group_name,
            e.code AS responsible_employee_code, e.full_name AS responsible_employee_name
       FROM shared.customers c
       LEFT JOIN shared.customer_groups g
         ON g.installation_id = c.installation_id AND g.id = c.group_id
       LEFT JOIN shared.employees e
         ON e.installation_id = c.installation_id AND e.id = c.responsible_employee_id
      WHERE c.installation_id = $1
        AND c.code = ANY($2::text[])`,
    [installationId, codes],
  );
  return result.rows;
}

async function loadGroupsByCodes(client, installationId, codes) {
  if (codes.length === 0) return [];
  const result = await client.query(
    `SELECT id, code, name, is_active
       FROM shared.customer_groups
      WHERE installation_id = $1
        AND code = ANY($2::text[])`,
    [installationId, codes],
  );
  return result.rows;
}

async function loadEmployeesByCodes(client, installationId, codes) {
  if (codes.length === 0) return [];
  const result = await client.query(
    `SELECT id, code, full_name, is_active
       FROM shared.employees
      WHERE installation_id = $1
        AND code = ANY($2::text[])`,
    [installationId, codes],
  );
  return result.rows;
}

async function lookupContext(client, { installationId, rows, mappings, includeCustomers }) {
  const customerCodes = [];
  const groupCodes = [];
  const employeeCodes = [];
  for (const row of rows) {
    const customerCode = mappingCell(row, mappings, 'CUSTOMER_CODE');
    if (includeCustomers && customerCode.present && code(customerCode.value)) customerCodes.push(code(customerCode.value));
    const groupCode = mappingCell(row, mappings, 'GROUP_CODE');
    if (groupCode.present && code(groupCode.value)) groupCodes.push(code(groupCode.value));
    const employeeCode = mappingCell(row, mappings, 'RESPONSIBLE_EMPLOYEE_CODE');
    if (employeeCode.present && code(employeeCode.value)) employeeCodes.push(code(employeeCode.value));
  }
  const [customers, groups, employees] = await Promise.all([
    includeCustomers ? loadCustomersByCodes(client, installationId, [...new Set(customerCodes)]) : Promise.resolve([]),
    loadGroupsByCodes(client, installationId, [...new Set(groupCodes)]),
    loadEmployeesByCodes(client, installationId, [...new Set(employeeCodes)]),
  ]);
  return {
    customers: new Map(customers.map((item) => [item.code, item])),
    groups: new Map(groups.map((item) => [item.code, item])),
    employees: new Map(employees.map((item) => [item.code, item])),
  };
}

function duplicateCodes(rows, mappings) {
  const counts = new Map();
  for (const row of rows) {
    const cell = mappingCell(row, mappings, 'CUSTOMER_CODE');
    const value = cell.present ? code(cell.value) : '';
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value));
}

function resolveReference(row, mappings, lookup) {
  const errors = [];
  let groupId = undefined;
  let responsibleEmployeeId = undefined;

  const groupCell = mappingCell(row, mappings, 'GROUP_CODE');
  if (groupCell.present) {
    const groupCode = code(groupCell.value);
    if (!groupCode) {
      groupId = null;
    } else {
      const group = lookup.groups.get(groupCode);
      if (!group) errors.push({ code: 'GROUP_NOT_FOUND', message: `Không tìm thấy nhóm khách hàng ${groupCode}` });
      else if (!group.is_active) errors.push({ code: 'GROUP_INACTIVE', message: `Nhóm khách hàng ${groupCode} đang ngừng sử dụng` });
      else groupId = group.id;
    }
  }

  const employeeCell = mappingCell(row, mappings, 'RESPONSIBLE_EMPLOYEE_CODE');
  if (employeeCell.present) {
    const employeeCode = code(employeeCell.value);
    if (!employeeCode) {
      responsibleEmployeeId = null;
    } else {
      const employee = lookup.employees.get(employeeCode);
      if (!employee) errors.push({ code: 'EMPLOYEE_NOT_FOUND', message: `Không tìm thấy nhân viên ${employeeCode}` });
      else if (!employee.is_active) errors.push({ code: 'EMPLOYEE_INACTIVE', message: `Nhân viên ${employeeCode} đang ngừng sử dụng` });
      else responsibleEmployeeId = employee.id;
    }
  }

  return { errors, groupId, responsibleEmployeeId };
}

function mappedCustomerPayload(row, mappings, references, { forImport = false } = {}) {
  const payload = {};
  const fieldMapping = [
    ['NAME', 'name'],
    ['PHONE', 'phone'],
    ['EMAIL', 'email'],
    ['TAX_CODE', 'taxCode'],
    ['PAYMENT_TERMS_DAYS', 'paymentTermsDays'],
    ['CREDIT_LIMIT', 'creditLimit'],
    ['NOTES', 'notes'],
  ];
  for (const [mapping, payloadKey] of fieldMapping) {
    const cell = mappingCell(row, mappings, mapping);
    if (!cell.present) continue;
    payload[payloadKey] = cell.value;
  }
  if (references.groupId !== undefined) payload.groupId = references.groupId;
  if (references.responsibleEmployeeId !== undefined) payload.responsibleEmployeeId = references.responsibleEmployeeId;
  if (forImport) {
    if (!Object.prototype.hasOwnProperty.call(payload, 'paymentTermsDays')) payload.paymentTermsDays = 0;
    if (!Object.prototype.hasOwnProperty.call(payload, 'creditLimit')) payload.creditLimit = '0';
  }
  return payload;
}

function prospectiveUpdateInput(customer, mapped) {
  const has = (key) => Object.prototype.hasOwnProperty.call(mapped, key);
  return {
    code: customer.code,
    name: has('name') ? mapped.name : customer.name,
    groupId: has('groupId') ? mapped.groupId : customer.group_id,
    responsibleEmployeeId: has('responsibleEmployeeId') ? mapped.responsibleEmployeeId : customer.responsible_employee_id,
    phone: has('phone') ? mapped.phone : customer.phone ?? '',
    email: has('email') ? mapped.email : customer.email ?? '',
    taxCode: has('taxCode') ? mapped.taxCode : customer.tax_code ?? '',
    paymentTermsDays: has('paymentTermsDays') ? mapped.paymentTermsDays : customer.payment_terms_days,
    creditLimit: has('creditLimit') ? mapped.creditLimit : customer.credit_limit,
    notes: has('notes') ? mapped.notes : customer.notes ?? '',
  };
}

function valueForCurrent(customer, mapping) {
  const descriptor = UPDATE_FIELDS[mapping];
  if (!descriptor) return '';
  return customer[descriptor.currentKey] ?? '';
}

function valueForNew(mapping, rawValue, references, lookup) {
  if (mapping === 'GROUP_CODE') {
    const normalized = code(rawValue);
    return normalized ? lookup.groups.get(normalized)?.code ?? normalized : '';
  }
  if (mapping === 'RESPONSIBLE_EMPLOYEE_CODE') {
    const normalized = code(rawValue);
    return normalized ? lookup.employees.get(normalized)?.code ?? normalized : '';
  }
  if (mapping === 'PAYMENT_TERMS_DAYS') return text(rawValue) || '0';
  if (mapping === 'CREDIT_LIMIT') return text(rawValue) || '0';
  return text(rawValue);
}

function previewChanges(row, mappings, customer, references, lookup) {
  const changes = [];
  for (let index = 1; index < mappings.length; index += 1) {
    const mapping = mappings[index];
    if (mapping === 'IGNORE' || mapping === 'CUSTOMER_CODE' || !UPDATE_FIELDS[mapping]) continue;
    if (index >= row.cells.length) continue;
    const oldValue = valueForCurrent(customer, mapping);
    const newValue = valueForNew(mapping, row.cells[index], references, lookup);
    if (String(oldValue ?? '') === String(newValue ?? '')) continue;
    changes.push({
      field: UPDATE_FIELDS[mapping].payloadKey,
      label: UPDATE_FIELDS[mapping].label,
      oldValue: display(oldValue),
      newValue: display(newValue),
    });
  }
  return changes;
}

export async function identifyCustomers(client, { installationId, payload }) {
  const rowsResult = normalizeRows(payload);
  if (!rowsResult.ok) return rowsResult;
  const rows = rowsResult.rows;
  const duplicate = new Set();
  const counts = new Map();
  for (const row of rows) {
    const value = code(row.cells[0]);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  for (const [value, count] of counts) if (count > 1) duplicate.add(value);
  const validCodes = [...counts.keys()].filter((value) => isCustomerCodeValid(value) && !duplicate.has(value));
  const customers = new Map((await loadCustomersByCodes(client, installationId, validCodes)).map((item) => [item.code, item]));
  const output = rows.map((row) => {
    const customerCode = code(row.cells[0]);
    const errors = [];
    if (!customerCode) errors.push({ code: 'MISSING_CUSTOMER_CODE', message: 'Thiếu Mã khách hàng' });
    else if (!isCustomerCodeValid(customerCode)) errors.push({ code: 'INVALID_CUSTOMER_CODE', message: 'Mã khách hàng không hợp lệ' });
    else if (duplicate.has(customerCode)) errors.push({ code: 'DUPLICATE_CUSTOMER_CODE', message: 'Mã khách hàng bị trùng trong tệp' });
    else if (!customers.has(customerCode)) errors.push({ code: 'CUSTOMER_NOT_FOUND', message: 'Không tìm thấy khách hàng' });
    const customer = customers.get(customerCode);
    return {
      rowNumber: row.rowNumber,
      customerCode,
      customerName: customer?.name ?? '',
      customerId: customer?.id ?? null,
      updatedAt: customer?.updated_at ?? null,
      status: errors.length ? 'error' : 'identified',
      errors,
      cells: row.cells,
    };
  });
  return {
    ok: true,
    identified: output.filter((row) => row.status === 'identified').length,
    skipped: output.filter((row) => row.status === 'error').length,
    rows: output,
  };
}

export async function importCustomers(client, { installationId, payload, createdBy }, deps = {}) {
  const rowsResult = normalizeRows(payload);
  if (!rowsResult.ok) return rowsResult;
  const mappingsResult = normalizeMappings(payload, 'import');
  if (!mappingsResult.ok) return mappingsResult;
  const rows = rowsResult.rows;
  const mappings = mappingsResult.mappings;
  const duplicates = duplicateCodes(rows, mappings);
  const lookup = await lookupContext(client, { installationId, rows, mappings, includeCustomers: true });
  const explicitCodes = new Set();
  for (const row of rows) {
    const cell = mappingCell(row, mappings, 'CUSTOMER_CODE');
    const value = cell.present ? code(cell.value) : '';
    if (value) explicitCodes.add(value);
  }
  const dryRun = payload?.dryRun === true;
  const allocator = !dryRun && rows.some((row) => !code(mappingCell(row, mappings, 'CUSTOMER_CODE').value))
    ? await createCustomerCodeAllocator(client, { installationId, reservedCodes: explicitCodes })
    : null;
  const output = [];
  let created = 0;

  for (const row of rows) {
    const explicitCell = mappingCell(row, mappings, 'CUSTOMER_CODE');
    const explicitCode = explicitCell.present ? code(explicitCell.value) : '';
    const references = resolveReference(row, mappings, lookup);
    const errors = [...references.errors];
    if (explicitCode && !isCustomerCodeValid(explicitCode)) errors.push({ code: 'INVALID_CUSTOMER_CODE', message: 'Mã khách hàng không hợp lệ' });
    if (explicitCode && duplicates.has(explicitCode)) errors.push({ code: 'DUPLICATE_CUSTOMER_CODE', message: 'Mã khách hàng bị trùng trong tệp' });
    if (explicitCode && lookup.customers.has(explicitCode)) errors.push({ code: 'CUSTOMER_EXISTS', message: 'Khách hàng đã tồn tại — bỏ qua' });

    const mapped = mappedCustomerPayload(row, mappings, references, { forImport: true });
    const name = text(mapped.name);
    if (!name) errors.push({ code: 'MISSING_CUSTOMER_NAME', message: 'Thiếu Tên khách hàng' });
    if (errors.length === 0) {
      const validation = customerService.validateCustomerInput({ ...mapped, code: explicitCode || 'KH000001', name });
      if (!validation.ok) errors.push({ code: validation.code, message: validation.message });
    }

    let finalCode = explicitCode;
    let customer = null;
    if (errors.length === 0 && !dryRun) {
      const create = deps.createCustomer ?? customerService.createCustomer;
      let createResult = null;
      for (let attempt = 0; attempt < (explicitCode ? 1 : 100); attempt += 1) {
        if (!explicitCode) finalCode = await allocator();
        createResult = await create(client, {
          installationId,
          payload: { ...mapped, code: finalCode },
          createdBy,
        });
        if (createResult.ok || explicitCode || createResult.code !== 'DUPLICATE_CODE') break;
      }
      if (!createResult?.ok) {
        errors.push({
          code: createResult?.code ?? 'CUSTOMER_CODE_GENERATION_CONFLICT',
          message: createResult?.message ?? 'Không thể cấp Mã khách hàng không trùng',
        });
      } else {
        customer = createResult.customer;
        created += 1;
      }
    }

    output.push({
      rowNumber: row.rowNumber,
      customerCode: finalCode || 'Tự sinh khi nhập',
      customerName: name,
      customerId: customer?.id ?? null,
      status: errors.length ? 'error' : dryRun ? 'ready' : 'created',
      errors,
      warnings: errors.length ? [] : [{ code: 'NO_DELIVERY_ADDRESS', message: 'Chưa có địa chỉ giao hàng' }],
      cells: row.cells,
    });
  }

  return {
    ok: true,
    created,
    ready: dryRun ? output.filter((row) => row.status === 'ready').length : 0,
    skipped: output.filter((row) => row.status === 'error').length,
    rows: output,
  };
}

export async function bulkUpdateCustomers(client, { installationId, payload, updatedBy }, deps = {}) {
  const rowsResult = normalizeRows(payload);
  if (!rowsResult.ok) return rowsResult;
  const mappingsResult = normalizeMappings(payload, 'update');
  if (!mappingsResult.ok) return mappingsResult;
  const rows = rowsResult.rows;
  const mappings = mappingsResult.mappings;
  const duplicates = duplicateCodes(rows, mappings);
  const lookup = await lookupContext(client, { installationId, rows, mappings, includeCustomers: true });
  const dryRun = payload?.dryRun === true;
  const output = [];
  let updated = 0;
  let unchanged = 0;

  for (const row of rows) {
    const customerCode = code(row.cells[0]);
    const errors = [];
    if (!customerCode) errors.push({ code: 'MISSING_CUSTOMER_CODE', message: 'Thiếu Mã khách hàng' });
    else if (!isCustomerCodeValid(customerCode)) errors.push({ code: 'INVALID_CUSTOMER_CODE', message: 'Mã khách hàng không hợp lệ' });
    else if (duplicates.has(customerCode)) errors.push({ code: 'DUPLICATE_CUSTOMER_CODE', message: 'Mã khách hàng bị trùng trong tệp' });
    const customer = lookup.customers.get(customerCode);
    if (customerCode && !duplicates.has(customerCode) && isCustomerCodeValid(customerCode) && !customer) {
      errors.push({ code: 'CUSTOMER_NOT_FOUND', message: 'Không tìm thấy khách hàng' });
    }
    const references = resolveReference(row, mappings, lookup);
    errors.push(...references.errors);
    const mapped = mappedCustomerPayload(row, mappings, references);
    if (customer && errors.length === 0) {
      const validation = customerService.validateCustomerInput(prospectiveUpdateInput(customer, mapped));
      if (!validation.ok) errors.push({ code: validation.code, message: validation.message });
    }
    const changes = customer ? previewChanges(row, mappings, customer, references, lookup) : [];

    let appliedStatus = null;
    if (customer && errors.length === 0 && !dryRun) {
      if (!row.expectedUpdatedAt) {
        errors.push({ code: 'MISSING_EXPECTED_UPDATED_AT', message: 'Bản xem trước đã hết hiệu lực, hãy xem trước lại' });
      } else if (new Date(customer.updated_at).toISOString() !== new Date(row.expectedUpdatedAt).toISOString()) {
        errors.push({ code: 'STALE_CUSTOMER', message: 'Khách hàng đã thay đổi, hãy xem trước lại' });
      } else if (changes.length === 0) {
        unchanged += 1;
        appliedStatus = 'unchanged';
      } else {
        const result = await (deps.updateCustomer ?? customerService.updateCustomer)(client, {
          id: customer.id,
          installationId,
          payload: { ...mapped, expectedUpdatedAt: row.expectedUpdatedAt },
          updatedBy,
        });
        if (!result.ok) errors.push({ code: result.code, message: result.message });
        else if (result.changed === false) {
          unchanged += 1;
          appliedStatus = 'unchanged';
        } else {
          updated += 1;
          appliedStatus = 'updated';
        }
      }
    } else if (customer && errors.length === 0 && dryRun && changes.length === 0) {
      unchanged += 1;
    }

    output.push({
      rowNumber: row.rowNumber,
      customerCode,
      customerName: customer?.name ?? '',
      customerId: customer?.id ?? null,
      expectedUpdatedAt: customer?.updated_at ?? null,
      status: errors.length ? 'error' : dryRun ? (changes.length ? 'ready' : 'unchanged') : (appliedStatus ?? 'unchanged'),
      errors,
      changes,
      cells: row.cells,
    });
  }

  return {
    ok: true,
    updated,
    ready: dryRun ? output.filter((row) => row.status === 'ready').length : 0,
    unchanged,
    skipped: output.filter((row) => row.status === 'error').length,
    rows: output,
  };
}

export const CUSTOMER_BULK_MAX_ROWS = MAX_ROWS;
