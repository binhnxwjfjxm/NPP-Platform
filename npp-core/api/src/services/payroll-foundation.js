import * as payrollRepo from '../db/repositories/payroll-foundation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_PATTERN = /^\d{1,15}(?:\.\d{1,2})?$/;
const COMPONENT_CODE_PATTERN = /^[A-Z0-9._-]{2,32}$/;
const CATEGORIES = new Set(['INCOME', 'DEDUCTION', 'REIMBURSEMENT']);
const RECURRENCES = new Set(['FIXED', 'PERIOD']);
const INPUT_MODES = new Set(['AUTOMATIC', 'MANUAL']);
const COMMANDS = new Set(['CREATE_PERIOD', 'SAVE_SALARY', 'CREATE_COMPONENT_TYPE', 'ASSIGN_FIXED_COMPONENT', 'ADD_PERIOD_COMPONENT']);
const INSTALLATION_TIMEZONE = 'Asia/Ho_Chi_Minh';

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(code, message) { return { ok: false, code, message, retryable: false }; }
function validUuid(value) { return typeof value === 'string' && UUID_PATTERN.test(value.trim()); }
function validDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function businessDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: INSTALLATION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
function previousDate(value) {
  const date = new Date(value + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
function moneyValue(value, label = 'Số tiền') {
  const raw = String(value ?? '').trim();
  if (!MONEY_PATTERN.test(raw)) return fail('INVALID_PAYROLL_AMOUNT', label + ' phải là số tiền hợp lệ, tối đa 2 chữ số thập phân');
  const [whole, fraction = ''] = raw.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '') || '0';
  return { ok: true, value: normalizedWhole + '.' + fraction.padEnd(2, '0') };
}
function noteValue(value, { required = false, label = 'Ghi chú' } = {}) {
  const result = text(value);
  if (required && !result) return fail('PAYROLL_NOTE_REQUIRED', label + ' là bắt buộc');
  if (result.length > 1000) return fail('PAYROLL_NOTE_TOO_LONG', label + ' tối đa 1.000 ký tự');
  return { ok: true, value: result || null };
}
function scopeAllowsBranch(branchId, { companyScope, branchIds }) {
  if (companyScope) return true;
  if (!branchId) return false;
  return new Set((branchIds ?? []).map(String)).has(String(branchId));
}
function componentEffective(component, onDate) {
  return component
    && component.is_active
    && component.effective_from <= onDate
    && (!component.effective_to || component.effective_to >= onDate);
}
async function scopedEmployeeAtDate(client, { installationId, employeeId, onDate, companyScope, branchIds }) {
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  const employees = await payrollRepo.listPayrollEmployees(client, {
    installationId, asOfDate: onDate, companyScope, branchIds,
  });
  const employee = employees.find((item) => String(item.id) === employeeId);
  return employee ? { ok: true, employee } : fail('SCOPE_FORBIDDEN', 'Nhân sự không có quan hệ lao động hoặc nằm ngoài phạm vi được cấp tại ngày hiệu lực');
}

export async function listPayrollFoundation(client, {
  installationId, companyScope, branchIds, rawPeriodId,
}) {
  const payrollPeriodId = text(rawPeriodId) || null;
  if (payrollPeriodId && !validUuid(payrollPeriodId)) return fail('PAYROLL_PERIOD_NOT_FOUND', 'Không tìm thấy kỳ lương');
  const [attendanceSources, periods, componentTypes, salaryProfiles, fixedComponents] = await Promise.all([
    payrollRepo.listClosedAttendanceSources(client, { installationId, companyScope, branchIds }),
    payrollRepo.listPayrollPeriods(client, { installationId, companyScope, branchIds }),
    payrollRepo.listComponentTypes(client, { installationId }),
    payrollRepo.listSalaryProfiles(client, { installationId, companyScope, branchIds }),
    payrollRepo.listFixedComponents(client, { installationId, companyScope, branchIds }),
  ]);
  const selectedPeriod = payrollPeriodId
    ? periods.find((period) => String(period.id) === payrollPeriodId) ?? null
    : periods[0] ?? null;
  if (payrollPeriodId && !selectedPeriod) return fail('PAYROLL_PERIOD_NOT_FOUND', 'Kỳ lương không tồn tại trong phạm vi được cấp');
  const asOfDate = selectedPeriod?.period_end ?? businessDate();
  const [employees, periodComponents] = await Promise.all([
    payrollRepo.listPayrollEmployees(client, { installationId, asOfDate, companyScope, branchIds }),
    payrollRepo.listPeriodComponents(client, { installationId, payrollPeriodId: selectedPeriod?.id ?? null }),
  ]);
  return {
    ok: true,
    data: {
      attendanceSources,
      periods,
      selectedPeriod,
      employees,
      componentTypes,
      salaryProfiles,
      fixedComponents,
      periodComponents,
      asOfDate,
    },
  };
}

async function createPeriod(client, { requestContext, payload, companyScope, branchIds }) {
  const attendancePeriodId = text(payload?.attendancePeriodId);
  if (!validUuid(attendancePeriodId)) return fail('ATTENDANCE_PERIOD_NOT_FOUND', 'Vui lòng chọn kỳ công đã chốt');
  const source = await payrollRepo.getClosedAttendanceSource(client, {
    installationId: requestContext.installationId,
    attendancePeriodId,
  });
  if (!source || source.status !== 'CLOSED' || !source.snapshot_id || !source.source_fingerprint || Number(source.revision) < 1) {
    return fail('ATTENDANCE_PERIOD_NOT_CLOSED', 'Kỳ công chưa có bản chốt hợp lệ để tạo kỳ lương');
  }
  if (!scopeAllowsBranch(source.branch_id, { companyScope, branchIds })) {
    return fail('SCOPE_FORBIDDEN', 'Kỳ công nằm ngoài phạm vi được cấp');
  }
  const existing = await payrollRepo.findPayrollPeriodByAttendanceSource(client, {
    installationId: requestContext.installationId,
    attendancePeriodId,
    revision: Number(source.revision),
  });
  if (existing) return fail('PAYROLL_PERIOD_EXISTS', 'Kỳ công này đã được dùng để tạo kỳ lương');
  const period = await payrollRepo.insertPayrollPeriod(client, {
    installationId: requestContext.installationId,
    attendancePeriodId,
    attendanceRevision: Number(source.revision),
    sourceFingerprint: source.source_fingerprint,
    branchId: source.branch_id,
    scopeKey: source.scope_key,
    periodStart: source.period_start,
    periodEnd: source.period_end,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  return {
    ok: true,
    data: period,
    audit: {
      action: 'create-payroll-period',
      resourceType: 'payroll-period',
      resourceId: period.id,
      beforeData: null,
      afterData: period,
      metadata: {
        attendancePeriodId,
        attendanceRevision: Number(source.revision),
        attendanceSourceFingerprint: source.source_fingerprint,
      },
    },
  };
}

async function saveSalary(client, { requestContext, payload, companyScope, branchIds }) {
  const employeeId = text(payload?.employeeId);
  const effectiveFrom = text(payload?.effectiveFrom);
  const amount = moneyValue(payload?.monthlySalary, 'Mức lương');
  if (!amount.ok) return amount;
  if (!validDate(effectiveFrom)) return fail('INVALID_PAYROLL_EFFECTIVE_DATE', 'Ngày áp dụng mức lương không hợp lệ');
  const note = noteValue(payload?.note);
  if (!note.ok) return note;
  const scoped = await scopedEmployeeAtDate(client, {
    installationId: requestContext.installationId,
    employeeId,
    onDate: effectiveFrom,
    companyScope,
    branchIds,
  });
  if (!scoped.ok) return scoped;
  const current = await payrollRepo.getOpenSalaryProfileForUpdate(client, {
    installationId: requestContext.installationId,
    employeeId,
  });
  if (current && current.effective_from >= effectiveFrom) {
    return fail('PAYROLL_EFFECTIVE_DATE_CONFLICT', 'Ngày áp dụng mới phải sau ngày bắt đầu của mức lương hiện hành');
  }
  if (current) {
    await payrollRepo.closeSalaryProfile(client, {
      installationId: requestContext.installationId,
      id: current.id,
      effectiveTo: previousDate(effectiveFrom),
    });
  }
  const profile = await payrollRepo.insertSalaryProfile(client, {
    installationId: requestContext.installationId,
    employeeId,
    monthlySalary: amount.value,
    effectiveFrom,
    note: note.value,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  return {
    ok: true,
    data: profile,
    audit: {
      action: 'save-salary-profile',
      resourceType: 'payroll-salary-profile',
      resourceId: profile.id,
      beforeData: current,
      afterData: profile,
      metadata: { employeeId, effectiveFrom },
    },
  };
}

async function createComponentType(client, { requestContext, payload, companyScope }) {
  if (!companyScope) return fail('SCOPE_FORBIDDEN', 'Chỉ phạm vi Công Ty được thiết lập danh mục khoản dùng chung');
  const code = text(payload?.code).toUpperCase();
  const name = text(payload?.name);
  const category = text(payload?.category).toUpperCase();
  const recurrence = text(payload?.recurrence).toUpperCase();
  const inputMode = text(payload?.inputMode).toUpperCase();
  const effectiveFrom = text(payload?.effectiveFrom);
  if (!COMPONENT_CODE_PATTERN.test(code)) return fail('INVALID_PAYROLL_COMPONENT_CODE', 'Mã khoản chỉ dùng chữ, số, dấu chấm, gạch dưới hoặc gạch ngang');
  if (!name || name.length > 120) return fail('INVALID_PAYROLL_COMPONENT_NAME', 'Tên khoản phải từ 1 đến 120 ký tự');
  if (!CATEGORIES.has(category)) return fail('INVALID_PAYROLL_COMPONENT_CATEGORY', 'Nhóm khoản không hợp lệ');
  if (!RECURRENCES.has(recurrence)) return fail('INVALID_PAYROLL_COMPONENT_RECURRENCE', 'Cách áp dụng khoản không hợp lệ');
  if (!INPUT_MODES.has(inputMode)) return fail('INVALID_PAYROLL_COMPONENT_INPUT_MODE', 'Cách ghi nhận khoản không hợp lệ');
  if (!validDate(effectiveFrom)) return fail('INVALID_PAYROLL_EFFECTIVE_DATE', 'Ngày áp dụng khoản không hợp lệ');
  const existing = await payrollRepo.findOpenComponentTypeByCode(client, {
    installationId: requestContext.installationId,
    code,
  });
  if (existing) return fail('PAYROLL_COMPONENT_CODE_EXISTS', 'Mã khoản đang được sử dụng');
  const component = await payrollRepo.insertComponentType(client, {
    installationId: requestContext.installationId,
    code,
    name,
    category,
    recurrence,
    inputMode,
    prorateByWorkdays: Boolean(payload?.prorateByWorkdays),
    includeInGross: Boolean(payload?.includeInGross),
    includeInNet: Boolean(payload?.includeInNet),
    effectiveFrom,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  return {
    ok: true,
    data: component,
    audit: {
      action: 'create-payroll-component-type',
      resourceType: 'payroll-component-type',
      resourceId: component.id,
      beforeData: null,
      afterData: component,
      metadata: { code, category, recurrence, inputMode },
    },
  };
}

async function assignFixedComponent(client, { requestContext, payload, companyScope, branchIds }) {
  const employeeId = text(payload?.employeeId);
  const componentTypeId = text(payload?.componentTypeId);
  const effectiveFrom = text(payload?.effectiveFrom);
  if (!validUuid(componentTypeId)) return fail('PAYROLL_COMPONENT_NOT_FOUND', 'Không tìm thấy khoản đã chọn');
  if (!validDate(effectiveFrom)) return fail('INVALID_PAYROLL_EFFECTIVE_DATE', 'Ngày áp dụng khoản cố định không hợp lệ');
  const amount = moneyValue(payload?.amount);
  if (!amount.ok) return amount;
  const note = noteValue(payload?.note);
  if (!note.ok) return note;
  const scoped = await scopedEmployeeAtDate(client, {
    installationId: requestContext.installationId,
    employeeId,
    onDate: effectiveFrom,
    companyScope,
    branchIds,
  });
  if (!scoped.ok) return scoped;
  const component = await payrollRepo.getComponentTypeById(client, {
    installationId: requestContext.installationId,
    id: componentTypeId,
  });
  if (!component || !componentEffective(component, effectiveFrom)) return fail('PAYROLL_COMPONENT_NOT_FOUND', 'Khoản không có hiệu lực tại ngày đã chọn');
  if (component.recurrence !== 'FIXED') return fail('PAYROLL_COMPONENT_NOT_FIXED', 'Khoản này được thiết lập theo kỳ, không phải khoản cố định');
  if (component.input_mode !== 'MANUAL') return fail('PAYROLL_COMPONENT_AUTOMATIC', 'Khoản tự động không nhập mức cố định bằng tay');
  const current = await payrollRepo.getOpenFixedComponentForUpdate(client, {
    installationId: requestContext.installationId,
    employeeId,
    componentTypeId,
  });
  if (current && current.effective_from >= effectiveFrom) {
    return fail('PAYROLL_EFFECTIVE_DATE_CONFLICT', 'Ngày áp dụng mới phải sau ngày bắt đầu của mức hiện hành');
  }
  if (current) {
    await payrollRepo.closeFixedComponent(client, {
      installationId: requestContext.installationId,
      id: current.id,
      effectiveTo: previousDate(effectiveFrom),
    });
  }
  const fixed = await payrollRepo.insertFixedComponent(client, {
    installationId: requestContext.installationId,
    employeeId,
    componentTypeId,
    amount: amount.value,
    effectiveFrom,
    note: note.value,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  return {
    ok: true,
    data: fixed,
    audit: {
      action: 'assign-fixed-payroll-component',
      resourceType: 'payroll-fixed-component',
      resourceId: fixed.id,
      beforeData: current,
      afterData: fixed,
      metadata: { employeeId, componentTypeId, effectiveFrom },
    },
  };
}

async function addPeriodComponent(client, { requestContext, payload, companyScope, branchIds }) {
  const payrollPeriodId = text(payload?.payrollPeriodId);
  const employeeId = text(payload?.employeeId);
  const componentTypeId = text(payload?.componentTypeId);
  if (!validUuid(payrollPeriodId)) return fail('PAYROLL_PERIOD_NOT_FOUND', 'Không tìm thấy kỳ lương');
  if (!validUuid(employeeId)) return fail('EMPLOYEE_NOT_FOUND', 'Không tìm thấy nhân sự');
  if (!validUuid(componentTypeId)) return fail('PAYROLL_COMPONENT_NOT_FOUND', 'Không tìm thấy khoản đã chọn');
  const amount = moneyValue(payload?.amount);
  if (!amount.ok) return amount;
  const note = noteValue(payload?.note, { required: true, label: 'Lý do / ghi chú' });
  if (!note.ok) return note;
  const period = await payrollRepo.getPayrollPeriodById(client, {
    installationId: requestContext.installationId,
    id: payrollPeriodId,
    forUpdate: true,
  });
  if (!period) return fail('PAYROLL_PERIOD_NOT_FOUND', 'Không tìm thấy kỳ lương');
  if (!scopeAllowsBranch(period.branch_id, { companyScope, branchIds })) return fail('SCOPE_FORBIDDEN', 'Kỳ lương nằm ngoài phạm vi được cấp');
  if (period.status === 'CLOSED') return fail('PAYROLL_PERIOD_CLOSED', 'Kỳ lương đã chốt, không thể thêm khoản phát sinh trực tiếp');
  const employee = await payrollRepo.employeeOverlapsPeriod(client, {
    installationId: requestContext.installationId,
    employeeId,
    periodStart: period.period_start,
    periodEnd: period.period_end,
    branchId: period.branch_id,
  });
  if (!employee) return fail('EMPLOYEE_NOT_IN_PAYROLL_PERIOD', 'Nhân sự không thuộc phạm vi lao động của kỳ lương');
  const component = await payrollRepo.getComponentTypeById(client, {
    installationId: requestContext.installationId,
    id: componentTypeId,
  });
  if (!component || !componentEffective(component, period.period_end)) return fail('PAYROLL_COMPONENT_NOT_FOUND', 'Khoản không có hiệu lực trong kỳ lương');
  if (component.recurrence !== 'PERIOD') return fail('PAYROLL_COMPONENT_NOT_PERIOD', 'Khoản này được thiết lập cố định, không nhập theo từng kỳ');
  if (component.input_mode !== 'MANUAL') return fail('PAYROLL_COMPONENT_AUTOMATIC', 'Khoản tự động không nhập thủ công theo kỳ');
  const entry = await payrollRepo.insertPeriodComponent(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    employeeId,
    componentTypeId,
    amount: amount.value,
    note: note.value,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  return {
    ok: true,
    data: entry,
    audit: {
      action: 'add-payroll-period-component',
      resourceType: 'payroll-period-component',
      resourceId: entry.id,
      beforeData: null,
      afterData: entry,
      metadata: { payrollPeriodId, employeeId, componentTypeId },
    },
  };
}

export async function mutatePayrollFoundation(client, {
  requestContext, payload, companyScope, branchIds,
}) {
  const command = text(payload?.command).toUpperCase();
  if (!COMMANDS.has(command)) return fail('INVALID_PAYROLL_COMMAND', 'Thao tác tính lương không hợp lệ');
  if (command === 'CREATE_PERIOD') return createPeriod(client, { requestContext, payload, companyScope, branchIds });
  if (command === 'SAVE_SALARY') return saveSalary(client, { requestContext, payload, companyScope, branchIds });
  if (command === 'CREATE_COMPONENT_TYPE') return createComponentType(client, { requestContext, payload, companyScope });
  if (command === 'ASSIGN_FIXED_COMPONENT') return assignFixedComponent(client, { requestContext, payload, companyScope, branchIds });
  return addPeriodComponent(client, { requestContext, payload, companyScope, branchIds });
}
