import { createHash } from 'node:crypto';
import * as payrollAggregationRepo from '../db/repositories/payroll-aggregation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMANDS = new Set(['AGGREGATE', 'RECONCILE']);
const DAY_SCALE_DIGITS = 6;
const DAY_SCALE = 10n ** BigInt(DAY_SCALE_DIGITS);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(code, message) { return { ok: false, code, message, retryable: false }; }
function validUuid(value) { return typeof value === 'string' && UUID_PATTERN.test(value.trim()); }
function scopeAllowsBranch(branchId, { companyScope, branchIds }) {
  if (companyScope) return true;
  if (!branchId) return false;
  return new Set((branchIds ?? []).map(String)).has(String(branchId));
}
function coversPeriod(record, fromKey, toKey, periodStart, periodEnd) {
  const from = String(record?.[fromKey] ?? '');
  const to = record?.[toKey] ? String(record[toKey]) : null;
  return Boolean(from) && from <= periodStart && (!to || to >= periodEnd);
}
function scaledDecimal(value) {
  const raw = String(value ?? '0').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return 0n;
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  const padded = (fraction + '0'.repeat(DAY_SCALE_DIGITS + 1)).slice(0, DAY_SCALE_DIGITS + 1);
  let result = BigInt(whole || '0') * DAY_SCALE + BigInt(padded.slice(0, DAY_SCALE_DIGITS) || '0');
  if (Number(padded[DAY_SCALE_DIGITS] ?? '0') >= 5) result += 1n;
  return negative ? -result : result;
}
function scaledToNumber(value) {
  return Number(value) / Number(DAY_SCALE);
}
function moneyCents(value) {
  const raw = String(value ?? '0').trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('invalid_money_value');
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = BigInt(whole || '0') * 100n + BigInt((fraction + '00').slice(0, 2));
  return negative ? -cents : cents;
}
function moneyString(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
function roundDivide(numerator, denominator) {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = (absolute + denominator / 2n) / denominator;
  return negative ? -quotient : quotient;
}
function prorateMoney(cents, payableDays, standardDays) {
  if (standardDays <= 0n) return 0n;
  return roundDivide(cents * payableDays, standardDays);
}
function addIssue(summary, group, key, value = 1) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return;
  summary[group][key] = Number(summary[group][key] ?? 0) + amount;
}
function issueTotal(group) {
  return Object.values(group ?? {}).reduce((sum, value) => sum + Number(value ?? 0), 0);
}
function sortByIdentity(rows) {
  return [...rows].sort((a, b) => {
    const employee = String(a.employee_id ?? a.employeeId ?? '').localeCompare(String(b.employee_id ?? b.employeeId ?? ''));
    if (employee !== 0) return employee;
    return String(a.id ?? a.component_type_id ?? '').localeCompare(String(b.id ?? b.component_type_id ?? ''));
  });
}
function sourceManifest(period, salaryProfiles, fixedComponents, periodComponents) {
  return {
    contractVersion: 1,
    calculationRuleVersion: 1,
    attendance: {
      periodId: period.attendance_period_id,
      revision: Number(period.attendance_revision),
      sourceFingerprint: period.attendance_source_fingerprint,
    },
    salaryProfiles: sortByIdentity(salaryProfiles).map((row) => ({
      id: row.id, employeeId: row.employee_id, amount: row.monthly_salary,
      from: row.effective_from, to: row.effective_to ?? null, currency: row.currency_code,
    })),
    fixedComponents: sortByIdentity(fixedComponents).map((row) => ({
      id: row.id, employeeId: row.employee_id, componentTypeId: row.component_type_id,
      amount: row.amount, from: row.effective_from, to: row.effective_to ?? null,
      typeFrom: row.type_effective_from, typeTo: row.type_effective_to ?? null,
      category: row.category, prorateByWorkdays: Boolean(row.prorate_by_workdays),
      includeInGross: Boolean(row.include_in_gross), includeInNet: Boolean(row.include_in_net),
    })),
    periodComponents: sortByIdentity(periodComponents).map((row) => ({
      id: row.id, employeeId: row.employee_id, componentTypeId: row.component_type_id,
      amount: row.amount, category: row.category, includeInGross: Boolean(row.include_in_gross),
      includeInNet: Boolean(row.include_in_net), source: row.source,
      sourceReference: row.source_reference ?? null,
    })),
  };
}
function fingerprint(manifest) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export function calculatePayrollSnapshot({
  period, attendanceSnapshot, salaryProfiles, fixedComponents, periodComponents,
}) {
  const attendanceEmployees = Array.isArray(attendanceSnapshot?.employees)
    ? attendanceSnapshot.employees
    : [];
  const issues = { blockers: {}, warnings: {} };
  if (!attendanceEmployees.length) addIssue(issues, 'blockers', 'emptyPayrollPeriod');

  const salaryByEmployee = new Map();
  for (const profile of salaryProfiles) {
    const key = String(profile.employee_id);
    if (!salaryByEmployee.has(key)) salaryByEmployee.set(key, []);
    salaryByEmployee.get(key).push(profile);
  }

  const fixedByEmployee = new Map();
  for (const component of fixedComponents) {
    const key = String(component.employee_id);
    if (!fixedByEmployee.has(key)) fixedByEmployee.set(key, []);
    fixedByEmployee.get(key).push(component);
  }

  const periodByEmployee = new Map();
  for (const component of periodComponents) {
    const key = String(component.employee_id);
    if (!periodByEmployee.has(key)) periodByEmployee.set(key, []);
    periodByEmployee.get(key).push(component);
  }

  let totalSalary = 0n;
  let totalGross = 0n;
  let totalNet = 0n;
  let totalIncome = 0n;
  let totalReimbursement = 0n;
  let totalDeduction = 0n;

  const rows = attendanceEmployees.map((attendance) => {
    const employeeId = String(attendance?.employeeId ?? '');
    const standardDays = scaledDecimal(attendance?.workDays ?? 0);
    const completedDays = scaledDecimal(attendance?.completedDays ?? 0);
    const paidLeaveDays = scaledDecimal(attendance?.paidLeaveDays ?? 0);
    const payableCandidate = completedDays + paidLeaveDays;
    const payableDays = standardDays > 0n
      ? (payableCandidate < 0n ? 0n : payableCandidate > standardDays ? standardDays : payableCandidate)
      : 0n;

    const salaryCandidates = salaryByEmployee.get(employeeId) ?? [];
    const fullSalary = salaryCandidates.filter((row) => coversPeriod(
      row, 'effective_from', 'effective_to', period.period_start, period.period_end,
    ));
    let monthlySalary = 0n;
    let salaryAmount = 0n;
    if (!salaryCandidates.length) {
      addIssue(issues, 'blockers', 'missingSalaryProfiles');
    } else if (salaryCandidates.length !== 1 || fullSalary.length !== 1) {
      addIssue(issues, 'blockers', 'salaryCoverageConflicts');
    } else {
      monthlySalary = moneyCents(fullSalary[0].monthly_salary);
      if (standardDays <= 0n && monthlySalary > 0n) {
        addIssue(issues, 'blockers', 'zeroStandardWorkdays');
      } else {
        salaryAmount = prorateMoney(monthlySalary, payableDays, standardDays);
      }
    }

    let incomeTotal = 0n;
    let reimbursementTotal = 0n;
    let deductionTotal = 0n;
    let gross = salaryAmount;
    let net = salaryAmount;
    const appliedFixed = [];

    const fixedGroups = new Map();
    for (const component of fixedByEmployee.get(employeeId) ?? []) {
      const key = String(component.component_type_id);
      if (!fixedGroups.has(key)) fixedGroups.set(key, []);
      fixedGroups.get(key).push(component);
    }
    for (const group of fixedGroups.values()) {
      const valid = group.filter((row) => (
        coversPeriod(row, 'effective_from', 'effective_to', period.period_start, period.period_end)
        && coversPeriod(row, 'type_effective_from', 'type_effective_to', period.period_start, period.period_end)
      ));
      if (group.length !== 1 || valid.length !== 1) {
        addIssue(issues, 'blockers', 'fixedComponentCoverageConflicts');
        continue;
      }
      const component = valid[0];
      const original = moneyCents(component.amount);
      const applied = component.prorate_by_workdays
        ? prorateMoney(original, payableDays, standardDays)
        : original;
      const signed = component.category === 'DEDUCTION' ? -applied : applied;
      if (component.category === 'INCOME') incomeTotal += applied;
      if (component.category === 'REIMBURSEMENT') reimbursementTotal += applied;
      if (component.category === 'DEDUCTION') deductionTotal += applied;
      if (component.include_in_gross) gross += signed;
      if (component.include_in_net) net += signed;
      appliedFixed.push({
        id: component.id,
        code: component.component_code,
        name: component.component_name,
        category: component.category,
        originalAmount: moneyString(original),
        appliedAmount: moneyString(applied),
        proratedByWorkdays: Boolean(component.prorate_by_workdays),
        includeInGross: Boolean(component.include_in_gross),
        includeInNet: Boolean(component.include_in_net),
      });
    }

    const appliedPeriod = [];
    for (const component of periodByEmployee.get(employeeId) ?? []) {
      const amount = moneyCents(component.amount);
      const signed = component.category === 'DEDUCTION' ? -amount : amount;
      if (component.category === 'INCOME') incomeTotal += amount;
      if (component.category === 'REIMBURSEMENT') reimbursementTotal += amount;
      if (component.category === 'DEDUCTION') deductionTotal += amount;
      if (component.include_in_gross) gross += signed;
      if (component.include_in_net) net += signed;
      appliedPeriod.push({
        id: component.id,
        code: component.component_code,
        name: component.component_name,
        category: component.category,
        amount: moneyString(amount),
        note: component.note,
        source: component.source,
        includeInGross: Boolean(component.include_in_gross),
        includeInNet: Boolean(component.include_in_net),
      });
    }

    const confirmedOvertimeMinutes = Number(attendance?.confirmedOvertimeMinutes ?? 0);
    if (confirmedOvertimeMinutes > 0) addIssue(issues, 'warnings', 'confirmedOvertimeEmployees');
    addIssue(issues, 'warnings', 'incompleteAttendanceDays', attendance?.incompleteDays);
    addIssue(issues, 'warnings', 'unexcusedAbsenceDays', attendance?.unexcusedAbsenceDays);
    addIssue(issues, 'warnings', 'violationDays', attendance?.violationDays);

    totalSalary += salaryAmount;
    totalIncome += incomeTotal;
    totalReimbursement += reimbursementTotal;
    totalDeduction += deductionTotal;
    totalGross += gross;
    totalNet += net;

    return {
      employeeId,
      employeeCode: String(attendance?.employeeCode ?? ''),
      employeeName: String(attendance?.employeeName ?? ''),
      branchId: attendance?.branchId ?? null,
      branchCode: attendance?.branchCode ?? null,
      branchName: attendance?.branchName ?? null,
      standardWorkDays: scaledToNumber(standardDays),
      payableWorkDays: scaledToNumber(payableDays),
      unpaidLeaveDays: Number(attendance?.unpaidLeaveDays ?? 0),
      confirmedOvertimeMinutes,
      monthlySalary: moneyString(monthlySalary),
      salaryAmount: moneyString(salaryAmount),
      incomeTotal: moneyString(incomeTotal),
      reimbursementTotal: moneyString(reimbursementTotal),
      deductionTotal: moneyString(deductionTotal),
      grossIncome: moneyString(gross),
      netPay: moneyString(net),
      fixedComponents: appliedFixed,
      periodComponents: appliedPeriod,
    };
  }).sort((a, b) => (
    a.employeeName.localeCompare(b.employeeName, 'vi')
    || a.employeeCode.localeCompare(b.employeeCode)
  ));

  const snapshot = {
    contractVersion: 1,
    period: {
      id: period.id,
      from: period.period_start,
      to: period.period_end,
      branchId: period.branch_id ?? null,
      currencyCode: period.currency_code,
      attendanceRevision: Number(period.attendance_revision),
    },
    totals: {
      employeeCount: rows.length,
      salaryAmount: moneyString(totalSalary),
      incomeTotal: moneyString(totalIncome),
      reimbursementTotal: moneyString(totalReimbursement),
      deductionTotal: moneyString(totalDeduction),
      grossIncome: moneyString(totalGross),
      netPay: moneyString(totalNet),
    },
    rows,
  };
  return {
    snapshot,
    issueSummary: issues,
    blockerTotal: issueTotal(issues.blockers),
    warningTotal: issueTotal(issues.warnings),
  };
}

export async function buildPayrollCalculation(client, source) {
  const inputs = await payrollAggregationRepo.loadPayrollCalculationInputs(client, source);
  const manifest = sourceManifest(source, inputs.salaryProfiles, inputs.fixedComponents, inputs.periodComponents);
  const calculated = calculatePayrollSnapshot({
    period: source,
    attendanceSnapshot: source.attendance_snapshot,
    salaryProfiles: inputs.salaryProfiles,
    fixedComponents: inputs.fixedComponents,
    periodComponents: inputs.periodComponents,
  });
  return {
    ...calculated,
    sourceManifest: manifest,
    sourceFingerprint: fingerprint(manifest),
  };
}

async function resolveSource(client, {
  requestContext, payrollPeriodId, companyScope, branchIds, forUpdate,
}) {
  if (!validUuid(payrollPeriodId)) return fail('PAYROLL_PERIOD_NOT_FOUND', 'Không tìm thấy kỳ lương');
  const source = await payrollAggregationRepo.getPayrollPeriodSource(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    forUpdate,
  });
  if (!source) return fail('PAYROLL_PERIOD_NOT_FOUND', 'Không tìm thấy kỳ lương');
  if (!scopeAllowsBranch(source.branch_id, { companyScope, branchIds })) {
    return fail('SCOPE_FORBIDDEN', 'Kỳ lương nằm ngoài phạm vi được cấp');
  }
  if (!source.attendance_snapshot || !source.attendance_snapshot_fingerprint) {
    return fail('PAYROLL_ATTENDANCE_SNAPSHOT_MISSING', 'Không tìm thấy bản chốt kỳ công của kỳ lương');
  }
  if (source.attendance_source_fingerprint !== source.attendance_snapshot_fingerprint) {
    return fail('PAYROLL_ATTENDANCE_SNAPSHOT_CHANGED', 'Nguồn bảng công của kỳ lương không còn khớp bản chốt đã ghi nhận');
  }
  return { ok: true, source };
}

export async function getPayrollCalculation(client, {
  requestContext, payrollPeriodId, companyScope, branchIds,
}) {
  if (!payrollPeriodId) return { ok: true, data: null };
  const resolved = await resolveSource(client, {
    requestContext, payrollPeriodId, companyScope, branchIds, forUpdate: false,
  });
  if (!resolved.ok) return resolved;
  const source = resolved.source;
  if (Number(source.calculation_revision ?? 0) < 1) {
    return { ok: true, data: null };
  }
  const snapshot = await payrollAggregationRepo.getCalculationSnapshot(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    revision: Number(source.calculation_revision),
  });
  if (!snapshot) return fail('PAYROLL_CALCULATION_MISSING', 'Không tìm thấy bản tổng hợp lương hiện tại');
  return {
    ok: true,
    data: {
      revision: snapshot.revision,
      sourceFingerprint: snapshot.source_fingerprint,
      issueSummary: snapshot.issue_summary,
      snapshot: snapshot.snapshot,
      createdAt: snapshot.created_at,
      createdBy: snapshot.created_by,
    },
  };
}

async function aggregate(client, {
  requestContext, payload, companyScope, branchIds,
}) {
  const payrollPeriodId = text(payload?.payrollPeriodId);
  const resolved = await resolveSource(client, {
    requestContext, payrollPeriodId, companyScope, branchIds, forUpdate: true,
  });
  if (!resolved.ok) return resolved;
  const source = resolved.source;
  if (source.status === 'CLOSED') return fail('PAYROLL_PERIOD_CLOSED', 'Kỳ lương đã chốt, không thể tổng hợp lại trực tiếp');
  const calculation = await buildPayrollCalculation(client, source);

  if (
    Number(source.calculation_revision ?? 0) > 0
    && source.calculation_fingerprint === calculation.sourceFingerprint
  ) {
    const existing = await payrollAggregationRepo.getCalculationSnapshot(client, {
      installationId: requestContext.installationId,
      payrollPeriodId,
      revision: Number(source.calculation_revision),
    });
    if (!existing) return fail('PAYROLL_CALCULATION_MISSING', 'Không tìm thấy bản tổng hợp lương hiện tại');
    return {
      ok: true,
      data: { period: source, calculation: existing, reused: true },
      audit: {
        action: 'reuse-payroll-aggregation',
        resourceType: 'payroll-period',
        resourceId: payrollPeriodId,
        beforeData: source,
        afterData: source,
        metadata: { calculationRevision: Number(source.calculation_revision), sourceFingerprint: calculation.sourceFingerprint },
      },
    };
  }

  const revision = Number(source.calculation_revision ?? 0) + 1;
  const snapshot = await payrollAggregationRepo.insertCalculationSnapshot(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    revision,
    sourceFingerprint: calculation.sourceFingerprint,
    snapshot: calculation.snapshot,
    issueSummary: calculation.issueSummary,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  const period = await payrollAggregationRepo.updatePayrollPeriodAggregation(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    status: calculation.blockerTotal > 0 ? 'NEEDS_ACTION' : 'AGGREGATING',
    revision,
    sourceFingerprint: calculation.sourceFingerprint,
    issueSummary: calculation.issueSummary,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  if (!period) return fail('PAYROLL_PERIOD_CONFLICT', 'Kỳ lương vừa thay đổi; hãy tải lại dữ liệu');
  return {
    ok: true,
    data: { period, calculation: snapshot, reused: false },
    audit: {
      action: 'aggregate-payroll-period',
      resourceType: 'payroll-period',
      resourceId: payrollPeriodId,
      beforeData: source,
      afterData: period,
      metadata: {
        calculationRevision: revision,
        sourceFingerprint: calculation.sourceFingerprint,
        blockers: calculation.issueSummary.blockers,
        warnings: calculation.issueSummary.warnings,
      },
    },
  };
}

async function reconcile(client, {
  requestContext, payload, companyScope, branchIds,
}) {
  const payrollPeriodId = text(payload?.payrollPeriodId);
  const note = text(payload?.note);
  if (note.length > 1000) return fail('PAYROLL_NOTE_TOO_LONG', 'Ghi chú đối soát tối đa 1.000 ký tự');
  const resolved = await resolveSource(client, {
    requestContext, payrollPeriodId, companyScope, branchIds, forUpdate: true,
  });
  if (!resolved.ok) return resolved;
  const source = resolved.source;
  if (source.status === 'CLOSED') return fail('PAYROLL_PERIOD_CLOSED', 'Kỳ lương đã chốt');
  if (Number(source.calculation_revision ?? 0) < 1 || !source.calculation_fingerprint) {
    return fail('PAYROLL_CALCULATION_MISSING', 'Cần tổng hợp lương trước khi đối soát');
  }
  const calculation = await buildPayrollCalculation(client, source);
  if (calculation.sourceFingerprint !== source.calculation_fingerprint) {
    return fail('PAYROLL_PERIOD_CHANGED', 'Dữ liệu tính lương đã thay đổi; cần tổng hợp lại trước khi đối soát');
  }
  if (calculation.blockerTotal > 0) {
    return fail('PAYROLL_PERIOD_HAS_BLOCKERS', 'Kỳ lương còn dữ liệu bắt buộc phải xử lý trước khi đối soát');
  }
  if (calculation.warningTotal > 0 && payload?.acknowledgeWarnings !== true) {
    return fail('PAYROLL_WARNINGS_UNACKNOWLEDGED', 'Kỳ lương còn cảnh báo; cần xác nhận đã kiểm tra trước khi đối soát');
  }
  if (calculation.warningTotal > 0 && !note) {
    return fail('PAYROLL_NOTE_REQUIRED', 'Vui lòng ghi chú kết quả kiểm tra cảnh báo');
  }
  const period = await payrollAggregationRepo.reconcilePayrollPeriod(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    sourceFingerprint: calculation.sourceFingerprint,
    issueSummary: calculation.issueSummary,
    actorId: requestContext.actorId,
    note: note || null,
    requestId: requestContext.requestId,
  });
  if (!period) return fail('PAYROLL_PERIOD_CONFLICT', 'Kỳ lương vừa thay đổi; hãy tải lại dữ liệu');
  const snapshot = await payrollAggregationRepo.getCalculationSnapshot(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    revision: Number(period.calculation_revision),
  });
  return {
    ok: true,
    data: { period, calculation: snapshot },
    audit: {
      action: 'reconcile-payroll-period',
      resourceType: 'payroll-period',
      resourceId: payrollPeriodId,
      beforeData: source,
      afterData: period,
      metadata: {
        calculationRevision: Number(period.calculation_revision),
        sourceFingerprint: calculation.sourceFingerprint,
        warnings: calculation.issueSummary.warnings,
      },
    },
  };
}

export async function mutatePayrollAggregation(client, {
  requestContext, payload, companyScope, branchIds,
}) {
  const command = text(payload?.command).toUpperCase();
  if (!COMMANDS.has(command)) return fail('INVALID_PAYROLL_COMMAND', 'Thao tác tính lương không hợp lệ');
  if (command === 'AGGREGATE') return aggregate(client, { requestContext, payload, companyScope, branchIds });
  return reconcile(client, { requestContext, payload, companyScope, branchIds });
}
