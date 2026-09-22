import { randomUUID } from 'node:crypto';

export async function getCloseSnapshot(client, { installationId, payrollPeriodId }) {
  const result = await client.query(
    `SELECT id, payroll_period_id, calculation_revision, calculation_fingerprint,
            snapshot, issue_summary, reconciled_by_actor_id, reconciled_at,
            reconciliation_note, request_id, created_by, created_at
       FROM shared.payroll_close_snapshots
      WHERE installation_id = $1 AND payroll_period_id = $2::uuid
      LIMIT 1`,
    [installationId, payrollPeriodId],
  );
  return result.rows?.[0] ?? null;
}

export async function listCloseHistory(client, { installationId, payrollPeriodIds }) {
  if (!payrollPeriodIds.length) return [];
  const result = await client.query(
    `SELECT id, payroll_period_id, calculation_revision, calculation_fingerprint,
            snapshot, issue_summary, reconciled_by_actor_id, reconciled_at,
            reconciliation_note, request_id, created_by, created_at
       FROM shared.payroll_close_snapshots
      WHERE installation_id = $1
        AND payroll_period_id = ANY($2::uuid[])
      ORDER BY (snapshot->'period'->>'to') DESC, created_at DESC, id DESC`,
    [installationId, payrollPeriodIds],
  );
  return result.rows ?? [];
}

export async function insertCloseSnapshot(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.payroll_close_snapshots (
       id, installation_id, payroll_period_id, calculation_revision,
       calculation_fingerprint, snapshot, issue_summary,
       reconciled_by_actor_id, reconciled_at, reconciliation_note,
       request_id, created_by, created_at
     ) VALUES ($1,$2,$3::uuid,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,now())
     RETURNING id, payroll_period_id, calculation_revision, calculation_fingerprint,
       snapshot, issue_summary, reconciled_by_actor_id, reconciled_at,
       reconciliation_note, request_id, created_by, created_at`,
    [
      id, values.installationId, values.payrollPeriodId, values.calculationRevision,
      values.calculationFingerprint, JSON.stringify(values.snapshot),
      JSON.stringify(values.issueSummary), values.reconciledByActorId,
      values.reconciledAt, values.reconciliationNote, values.requestId, values.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function insertPayslipSnapshot(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.payroll_payslip_snapshots (
       id, installation_id, payroll_period_id, employee_id, revision,
       close_snapshot_id, previous_snapshot_id, source_kind, source_adjustment_id,
       snapshot, request_id, created_by, created_at
     ) VALUES ($1,$2,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid,$8,$9::uuid,$10::jsonb,$11,$12,now())
     RETURNING id, payroll_period_id, employee_id, revision, close_snapshot_id,
       previous_snapshot_id, source_kind, source_adjustment_id,
       snapshot, request_id, created_by, created_at`,
    [
      id, values.installationId, values.payrollPeriodId, values.employeeId,
      values.revision, values.closeSnapshotId, values.previousSnapshotId ?? null,
      values.sourceKind, values.sourceAdjustmentId ?? null,
      JSON.stringify(values.snapshot), values.requestId, values.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function listLatestPayslips(client, { installationId, payrollPeriodId }) {
  const result = await client.query(
    `SELECT DISTINCT ON (employee_id)
            id, payroll_period_id, employee_id, revision, close_snapshot_id,
            previous_snapshot_id, source_kind, source_adjustment_id,
            snapshot, request_id, created_by, created_at
       FROM shared.payroll_payslip_snapshots
      WHERE installation_id = $1 AND payroll_period_id = $2::uuid
      ORDER BY employee_id, revision DESC`,
    [installationId, payrollPeriodId],
  );
  return result.rows ?? [];
}

export async function listPayslipHistory(client, { installationId, payrollPeriodId }) {
  const result = await client.query(
    `SELECT id, payroll_period_id, employee_id, revision, close_snapshot_id,
            previous_snapshot_id, source_kind, source_adjustment_id,
            snapshot, request_id, created_by, created_at
       FROM shared.payroll_payslip_snapshots
      WHERE installation_id = $1 AND payroll_period_id = $2::uuid
      ORDER BY employee_id, revision, created_at, id`,
    [installationId, payrollPeriodId],
  );
  return result.rows ?? [];
}

export async function getLatestPayslipForUpdate(client, { installationId, payrollPeriodId, employeeId }) {
  const result = await client.query(
    `SELECT id, payroll_period_id, employee_id, revision, close_snapshot_id,
            previous_snapshot_id, source_kind, source_adjustment_id,
            snapshot, request_id, created_by, created_at
       FROM shared.payroll_payslip_snapshots
      WHERE installation_id = $1
        AND payroll_period_id = $2::uuid
        AND employee_id = $3::uuid
      ORDER BY revision DESC
      LIMIT 1
      FOR UPDATE`,
    [installationId, payrollPeriodId, employeeId],
  );
  return result.rows?.[0] ?? null;
}

export async function listAdjustments(client, { installationId, payrollPeriodId }) {
  const result = await client.query(
    `SELECT id, payroll_period_id, employee_id, component_type_id,
            component_code, component_name, category,
            include_in_gross, include_in_net, direction, amount::text AS amount,
            reason, previous_payslip_snapshot_id, resulting_revision,
            before_snapshot, after_snapshot, request_id, created_by, created_at
       FROM shared.payroll_adjustments
      WHERE installation_id = $1 AND payroll_period_id = $2::uuid
      ORDER BY created_at, id`,
    [installationId, payrollPeriodId],
  );
  return result.rows ?? [];
}

export async function insertAdjustment(client, values) {
  const id = values.id ?? randomUUID();
  const result = await client.query(
    `INSERT INTO shared.payroll_adjustments (
       id, installation_id, payroll_period_id, employee_id, component_type_id,
       component_code, component_name, category, include_in_gross, include_in_net,
       direction, amount, reason, previous_payslip_snapshot_id, resulting_revision,
       before_snapshot, after_snapshot, request_id, created_by, created_at
     ) VALUES ($1,$2,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12::numeric,$13,$14::uuid,$15,$16::jsonb,$17::jsonb,$18,$19,now())
     RETURNING id, payroll_period_id, employee_id, component_type_id,
       component_code, component_name, category, include_in_gross, include_in_net,
       direction, amount::text AS amount, reason, previous_payslip_snapshot_id,
       resulting_revision, before_snapshot, after_snapshot, request_id, created_by, created_at`,
    [
      id, values.installationId, values.payrollPeriodId, values.employeeId,
      values.componentTypeId, values.componentCode, values.componentName,
      values.category, values.includeInGross, values.includeInNet,
      values.direction, values.amount, values.reason, values.previousPayslipSnapshotId,
      values.resultingRevision, JSON.stringify(values.beforeSnapshot),
      JSON.stringify(values.afterSnapshot), values.requestId, values.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function closePayrollPeriod(client, values) {
  const result = await client.query(
    `UPDATE shared.payroll_periods
        SET status = 'CLOSED',
            closed_calculation_revision = calculation_revision,
            closed_calculation_fingerprint = $3,
            closed_by_actor_id = $4,
            closed_at = now(),
            request_id = $5,
            updated_by = $4,
            updated_at = now()
      WHERE installation_id = $1
        AND id = $2::uuid
        AND status = 'RECONCILED'
        AND calculation_fingerprint = $3
        AND reconciled_fingerprint = $3
      RETURNING id, attendance_period_id, attendance_revision,
        attendance_source_fingerprint, branch_id, scope_key,
        to_char(period_start, 'YYYY-MM-DD') AS period_start,
        to_char(period_end, 'YYYY-MM-DD') AS period_end,
        status, currency_code, calculation_revision, calculation_fingerprint,
        issue_summary, reconciled_fingerprint, reconciled_by_actor_id,
        reconciled_at, reconciliation_note, closed_calculation_revision,
        closed_calculation_fingerprint, closed_by_actor_id, closed_at,
        created_at, updated_at`,
    [
      values.installationId, values.payrollPeriodId, values.calculationFingerprint,
      values.actorId, values.requestId,
    ],
  );
  return result.rows?.[0] ?? null;
}
