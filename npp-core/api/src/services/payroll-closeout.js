import { randomUUID } from 'node:crypto';
import * as payrollAggregationRepo from '../db/repositories/payroll-aggregation.js';
import * as payrollCloseoutRepo from '../db/repositories/payroll-closeout.js';
import * as payrollFoundationRepo from '../db/repositories/payroll-foundation.js';
import { buildPayrollCalculation } from './payroll-aggregation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_PATTERN = /^\d{1,15}(?:\.\d{1,2})?$/;
const COMMANDS = new Set(['CLOSE', 'ADJUST']);
const DIRECTIONS = new Set(['ADD', 'REVERSE']);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function fail(code, message) { return { ok: false, code, message, retryable: false }; }
function validUuid(value) { return typeof value === 'string' && UUID_PATTERN.test(value.trim()); }
function scopeAllowsBranch(branchId, { companyScope, branchIds }) {
  if (companyScope) return true;
  if (!branchId) return false;
  return new Set((branchIds ?? []).map(String)).has(String(branchId));
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
function amountValue(value) {
  const raw = String(value ?? '').trim();
  if (!MONEY_PATTERN.test(raw) || moneyCents(raw) <= 0n) {
    return fail('INVALID_PAYROLL_AMOUNT', 'Số tiền điều chỉnh phải lớn hơn 0 và có tối đa 2 chữ số thập phân');
  }
  const [whole, fraction = ''] = raw.split('.');
  return { ok: true, value: (whole.replace(/^0+(?=\d)/, '') || '0') + '.' + fraction.padEnd(2, '0') };
}
function noteValue(value) {
  const reason = text(value);
  if (!reason) return fail('PAYROLL_NOTE_REQUIRED', 'Vui lòng nhập lý do điều chỉnh');
  if (reason.length > 1000) return fail('PAYROLL_NOTE_TOO_LONG', 'Lý do điều chỉnh tối đa 1.000 ký tự');
  return { ok: true, value: reason };
}
async function resolveSource(client, { requestContext, payrollPeriodId, companyScope, branchIds, forUpdate }) {
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
  return { ok: true, source };
}
function payslipFromClose(closeSnapshot, row) {
  return {
    contractVersion: 1,
    period: closeSnapshot.snapshot.period,
    employee: {
      id: row.employeeId,
      code: row.employeeCode,
      name: row.employeeName,
      branchId: row.branchId ?? null,
      branchCode: row.branchCode ?? null,
      branchName: row.branchName ?? null,
    },
    pay: row,
    adjustments: [],
    close: {
      calculationRevision: Number(closeSnapshot.calculation_revision),
      calculationFingerprint: closeSnapshot.calculation_fingerprint,
      closedAt: closeSnapshot.created_at,
      closedBy: closeSnapshot.created_by,
    },
  };
}

export function applyPayrollAdjustment(snapshot, adjustment) {
  const after = structuredClone(snapshot);
  const pay = after?.pay;
  if (!pay || typeof pay !== 'object') throw new Error('invalid_payslip_snapshot');
  const amount = moneyCents(adjustment.amount);
  const delta = adjustment.direction === 'ADD' ? amount : -amount;
  const categoryField = adjustment.category === 'INCOME'
    ? 'incomeTotal'
    : adjustment.category === 'REIMBURSEMENT'
      ? 'reimbursementTotal'
      : 'deductionTotal';
  pay[categoryField] = moneyString(moneyCents(pay[categoryField] ?? '0') + delta);
  const payEffect = adjustment.category === 'DEDUCTION' ? -delta : delta;
  if (adjustment.includeInGross) pay.grossIncome = moneyString(moneyCents(pay.grossIncome ?? '0') + payEffect);
  if (adjustment.includeInNet) pay.netPay = moneyString(moneyCents(pay.netPay ?? '0') + payEffect);
  after.adjustments = [
    ...(Array.isArray(after.adjustments) ? after.adjustments : []),
    {
      id: adjustment.id,
      componentTypeId: adjustment.componentTypeId,
      code: adjustment.componentCode,
      name: adjustment.componentName,
      category: adjustment.category,
      direction: adjustment.direction,
      amount: moneyString(amount),
      reason: adjustment.reason,
      createdBy: adjustment.actorId,
      requestId: adjustment.requestId,
    },
  ];
  return after;
}

export async function getPayrollCloseout(client, {
  requestContext, payrollPeriodId, visiblePeriodIds, companyScope, branchIds,
}) {
  const history = await payrollCloseoutRepo.listCloseHistory(client, {
    installationId: requestContext.installationId,
    payrollPeriodIds: (visiblePeriodIds ?? []).filter(validUuid),
  });
  if (!payrollPeriodId) {
    return { ok: true, data: { closeSnapshot: null, payslips: [], payslipHistory: [], adjustments: [], history } };
  }
  const resolved = await resolveSource(client, {
    requestContext, payrollPeriodId, companyScope, branchIds, forUpdate: false,
  });
  if (!resolved.ok) return resolved;
  if (resolved.source.status !== 'CLOSED') {
    return { ok: true, data: { closeSnapshot: null, payslips: [], payslipHistory: [], adjustments: [], history } };
  }
  const closeSnapshot = await payrollCloseoutRepo.getCloseSnapshot(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
  });
  if (!closeSnapshot) return fail('PAYROLL_CLOSE_SNAPSHOT_MISSING', 'Không tìm thấy hồ sơ chốt lương của kỳ đã chốt');
  const [payslips, payslipHistory, adjustments] = await Promise.all([
    payrollCloseoutRepo.listLatestPayslips(client, { installationId: requestContext.installationId, payrollPeriodId }),
    payrollCloseoutRepo.listPayslipHistory(client, { installationId: requestContext.installationId, payrollPeriodId }),
    payrollCloseoutRepo.listAdjustments(client, { installationId: requestContext.installationId, payrollPeriodId }),
  ]);
  return { ok: true, data: { closeSnapshot, payslips, payslipHistory, adjustments, history } };
}

async function closePayroll(client, { requestContext, payload, companyScope, branchIds }) {
  const payrollPeriodId = text(payload?.payrollPeriodId);
  const resolved = await resolveSource(client, {
    requestContext, payrollPeriodId, companyScope, branchIds, forUpdate: true,
  });
  if (!resolved.ok) return resolved;
  const source = resolved.source;
  if (source.status !== 'RECONCILED') {
    return fail('PAYROLL_PERIOD_NOT_RECONCILED', 'Chỉ kỳ lương đã đối soát mới được chốt');
  }
  if (!source.calculation_fingerprint || source.reconciled_fingerprint !== source.calculation_fingerprint) {
    return fail('PAYROLL_PERIOD_CHANGED', 'Bản tổng hợp hiện tại không còn khớp kết quả đối soát');
  }
  const current = await buildPayrollCalculation(client, source);
  if (current.sourceFingerprint !== source.calculation_fingerprint) {
    return fail('PAYROLL_PERIOD_CHANGED', 'Dữ liệu tính lương đã thay đổi sau đối soát; cần tổng hợp và đối soát lại');
  }
  const calculation = await payrollAggregationRepo.getCalculationSnapshot(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    revision: Number(source.calculation_revision),
  });
  if (!calculation || calculation.source_fingerprint !== source.calculation_fingerprint) {
    return fail('PAYROLL_CALCULATION_MISSING', 'Không tìm thấy đúng bản tổng hợp đã đối soát');
  }
  const closeSnapshot = await payrollCloseoutRepo.insertCloseSnapshot(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    calculationRevision: Number(calculation.revision),
    calculationFingerprint: calculation.source_fingerprint,
    snapshot: calculation.snapshot,
    issueSummary: calculation.issue_summary,
    reconciledByActorId: source.reconciled_by_actor_id ?? null,
    reconciledAt: source.reconciled_at ?? null,
    reconciliationNote: source.reconciliation_note ?? null,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  const rows = Array.isArray(calculation.snapshot?.rows) ? calculation.snapshot.rows : [];
  for (const row of rows) {
    if (!validUuid(String(row?.employeeId ?? ''))) continue;
    await payrollCloseoutRepo.insertPayslipSnapshot(client, {
      installationId: requestContext.installationId,
      payrollPeriodId,
      employeeId: row.employeeId,
      revision: 1,
      closeSnapshotId: closeSnapshot.id,
      previousSnapshotId: null,
      sourceKind: 'CLOSE',
      sourceAdjustmentId: null,
      snapshot: payslipFromClose(closeSnapshot, row),
      requestId: requestContext.requestId,
      actorId: requestContext.actorId,
    });
  }
  const period = await payrollCloseoutRepo.closePayrollPeriod(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    calculationFingerprint: calculation.source_fingerprint,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  if (!period) return fail('PAYROLL_PERIOD_CONFLICT', 'Kỳ lương vừa thay đổi; hãy tải lại dữ liệu');
  return {
    ok: true,
    data: { period, closeSnapshot },
    audit: {
      action: 'close-payroll-period',
      resourceType: 'payroll-period',
      resourceId: payrollPeriodId,
      beforeData: source,
      afterData: period,
      metadata: {
        calculationRevision: Number(calculation.revision),
        calculationFingerprint: calculation.source_fingerprint,
        payslipCount: rows.length,
      },
    },
  };
}

async function adjustPayroll(client, { requestContext, payload, companyScope, branchIds }) {
  const payrollPeriodId = text(payload?.payrollPeriodId);
  const employeeId = text(payload?.employeeId);
  const componentTypeId = text(payload?.componentTypeId);
  const direction = text(payload?.direction).toUpperCase();
  if (!validUuid(employeeId)) return fail('PAYROLL_PAYSLIP_NOT_FOUND', 'Không tìm thấy phiếu lương nhân sự');
  if (!validUuid(componentTypeId)) return fail('PAYROLL_COMPONENT_NOT_FOUND', 'Không tìm thấy khoản điều chỉnh');
  if (!DIRECTIONS.has(direction)) return fail('INVALID_PAYROLL_ADJUSTMENT_DIRECTION', 'Chiều điều chỉnh không hợp lệ');
  const amount = amountValue(payload?.amount);
  if (!amount.ok) return amount;
  const reason = noteValue(payload?.reason);
  if (!reason.ok) return reason;
  const resolved = await resolveSource(client, {
    requestContext, payrollPeriodId, companyScope, branchIds, forUpdate: true,
  });
  if (!resolved.ok) return resolved;
  const source = resolved.source;
  if (source.status !== 'CLOSED') return fail('PAYROLL_PERIOD_NOT_CLOSED', 'Chỉ điều chỉnh sau khi kỳ lương đã chốt');
  const closeSnapshot = await payrollCloseoutRepo.getCloseSnapshot(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
  });
  if (!closeSnapshot) return fail('PAYROLL_CLOSE_SNAPSHOT_MISSING', 'Không tìm thấy hồ sơ chốt lương');
  const latest = await payrollCloseoutRepo.getLatestPayslipForUpdate(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    employeeId,
  });
  if (!latest) return fail('PAYROLL_PAYSLIP_NOT_FOUND', 'Không tìm thấy phiếu lương nhân sự trong kỳ đã chốt');
  const component = await payrollFoundationRepo.getComponentTypeById(client, {
    installationId: requestContext.installationId,
    id: componentTypeId,
  });
  if (!component) return fail('PAYROLL_COMPONENT_NOT_FOUND', 'Không tìm thấy khoản điều chỉnh');
  const adjustmentId = randomUUID();
  const revision = Number(latest.revision) + 1;
  const afterSnapshot = applyPayrollAdjustment(latest.snapshot, {
    id: adjustmentId,
    componentTypeId,
    componentCode: component.code,
    componentName: component.name,
    category: component.category,
    includeInGross: Boolean(component.include_in_gross),
    includeInNet: Boolean(component.include_in_net),
    direction,
    amount: amount.value,
    reason: reason.value,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
  });
  const adjustment = await payrollCloseoutRepo.insertAdjustment(client, {
    id: adjustmentId,
    installationId: requestContext.installationId,
    payrollPeriodId,
    employeeId,
    componentTypeId,
    componentCode: component.code,
    componentName: component.name,
    category: component.category,
    includeInGross: Boolean(component.include_in_gross),
    includeInNet: Boolean(component.include_in_net),
    direction,
    amount: amount.value,
    reason: reason.value,
    previousPayslipSnapshotId: latest.id,
    resultingRevision: revision,
    beforeSnapshot: latest.snapshot,
    afterSnapshot,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  const payslip = await payrollCloseoutRepo.insertPayslipSnapshot(client, {
    installationId: requestContext.installationId,
    payrollPeriodId,
    employeeId,
    revision,
    closeSnapshotId: closeSnapshot.id,
    previousSnapshotId: latest.id,
    sourceKind: 'ADJUSTMENT',
    sourceAdjustmentId: adjustment.id,
    snapshot: afterSnapshot,
    requestId: requestContext.requestId,
    actorId: requestContext.actorId,
  });
  return {
    ok: true,
    data: { adjustment, payslip },
    audit: {
      action: 'adjust-closed-payroll',
      resourceType: 'payroll-payslip',
      resourceId: payslip.id,
      beforeData: latest.snapshot,
      afterData: afterSnapshot,
      metadata: {
        payrollPeriodId,
        employeeId,
        adjustmentId: adjustment.id,
        componentTypeId,
        direction,
        resultingRevision: revision,
        reason: reason.value,
      },
    },
  };
}

export async function mutatePayrollCloseout(client, {
  requestContext, payload, companyScope, branchIds,
}) {
  const command = text(payload?.command).toUpperCase();
  if (!COMMANDS.has(command)) return fail('INVALID_PAYROLL_COMMAND', 'Thao tác tính lương không hợp lệ');
  if (command === 'CLOSE') return closePayroll(client, { requestContext, payload, companyScope, branchIds });
  return adjustPayroll(client, { requestContext, payload, companyScope, branchIds });
}
