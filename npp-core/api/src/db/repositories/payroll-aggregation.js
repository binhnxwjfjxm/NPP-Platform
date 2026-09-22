import { randomUUID } from 'node:crypto';

const PERIOD_COLUMNS = `
  p.id, p.installation_id, p.attendance_period_id, p.attendance_revision,
  p.attendance_source_fingerprint, p.branch_id, p.scope_key,
  to_char(p.period_start, 'YYYY-MM-DD') AS period_start,
  to_char(p.period_end, 'YYYY-MM-DD') AS period_end,
  p.status, p.currency_code, p.calculation_revision, p.calculation_fingerprint,
  p.issue_summary, p.reconciled_fingerprint, p.reconciled_by_actor_id,
  p.reconciled_at, p.reconciliation_note, p.created_at, p.updated_at
`;

export async function getPayrollPeriodSource(client, {
  installationId, payrollPeriodId, forUpdate = false,
}) {
  const periodResult = await client.query(
    `SELECT ${PERIOD_COLUMNS}, b.code AS branch_code, b.name AS branch_name
       FROM shared.payroll_periods p
       LEFT JOIN shared.branches b
         ON b.installation_id = p.installation_id AND b.id = p.branch_id
      WHERE p.installation_id = $1 AND p.id = $2::uuid
      ${forUpdate ? 'FOR UPDATE OF p' : ''}`,
    [installationId, payrollPeriodId],
  );
  const period = periodResult.rows?.[0] ?? null;
  if (!period) return null;
  const snapshotResult = await client.query(
    `SELECT source_fingerprint, snapshot
       FROM shared.attendance_period_snapshots
      WHERE installation_id = $1
        AND period_id = $2::uuid
        AND revision = $3
      LIMIT 1`,
    [installationId, period.attendance_period_id, Number(period.attendance_revision)],
  );
  const attendance = snapshotResult.rows?.[0] ?? null;
  return attendance
    ? {
        ...period,
        attendance_snapshot_fingerprint: attendance.source_fingerprint,
        attendance_snapshot: attendance.snapshot,
      }
    : { ...period, attendance_snapshot_fingerprint: null, attendance_snapshot: null };
}

export async function listSalaryProfilesForPeriod(client, {
  installationId, employeeIds, periodStart, periodEnd,
}) {
  if (!employeeIds.length) return [];
  const result = await client.query(
    `SELECT id, employee_id, monthly_salary::text AS monthly_salary, currency_code,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(effective_to, 'YYYY-MM-DD') AS effective_to
       FROM shared.payroll_salary_profiles
      WHERE installation_id = $1
        AND employee_id = ANY($2::uuid[])
        AND effective_from <= $4::date
        AND (effective_to IS NULL OR effective_to >= $3::date)
      ORDER BY employee_id, effective_from, id`,
    [installationId, employeeIds, periodStart, periodEnd],
  );
  return result.rows ?? [];
}

export async function listFixedComponentsForPeriod(client, {
  installationId, employeeIds, periodStart, periodEnd,
}) {
  if (!employeeIds.length) return [];
  const result = await client.query(
    `SELECT f.id, f.employee_id, f.component_type_id, f.amount::text AS amount,
            to_char(f.effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(f.effective_to, 'YYYY-MM-DD') AS effective_to,
            t.code AS component_code, t.name AS component_name, t.category,
            t.recurrence, t.input_mode, t.prorate_by_workdays,
            t.include_in_gross, t.include_in_net,
            to_char(t.effective_from, 'YYYY-MM-DD') AS type_effective_from,
            to_char(t.effective_to, 'YYYY-MM-DD') AS type_effective_to
       FROM shared.payroll_employee_fixed_components f
       JOIN shared.payroll_component_types t
         ON t.installation_id = f.installation_id AND t.id = f.component_type_id
      WHERE f.installation_id = $1
        AND f.employee_id = ANY($2::uuid[])
        AND f.effective_from <= $4::date
        AND (f.effective_to IS NULL OR f.effective_to >= $3::date)
      ORDER BY f.employee_id, f.component_type_id, f.effective_from, f.id`,
    [installationId, employeeIds, periodStart, periodEnd],
  );
  return result.rows ?? [];
}

export async function listPeriodComponentsForCalculation(client, {
  installationId, payrollPeriodId,
}) {
  const result = await client.query(
    `SELECT c.id, c.employee_id, c.component_type_id, c.amount::text AS amount,
            c.note, c.source, c.source_reference,
            t.code AS component_code, t.name AS component_name, t.category,
            t.recurrence, t.input_mode, t.prorate_by_workdays,
            t.include_in_gross, t.include_in_net,
            to_char(t.effective_from, 'YYYY-MM-DD') AS type_effective_from,
            to_char(t.effective_to, 'YYYY-MM-DD') AS type_effective_to
       FROM shared.payroll_period_components c
       JOIN shared.payroll_component_types t
         ON t.installation_id = c.installation_id AND t.id = c.component_type_id
      WHERE c.installation_id = $1 AND c.payroll_period_id = $2::uuid
      ORDER BY c.employee_id, c.created_at, c.id`,
    [installationId, payrollPeriodId],
  );
  return result.rows ?? [];
}

export async function loadPayrollCalculationInputs(client, source) {
  const employees = Array.isArray(source.attendance_snapshot?.employees)
    ? source.attendance_snapshot.employees
    : [];
  const employeeIds = employees
    .map((employee) => String(employee?.employeeId ?? ''))
    .filter(Boolean);
  const salaryProfiles = await listSalaryProfilesForPeriod(client, {
    installationId: source.installation_id,
    employeeIds,
    periodStart: source.period_start,
    periodEnd: source.period_end,
  });
  const fixedComponents = await listFixedComponentsForPeriod(client, {
    installationId: source.installation_id,
    employeeIds,
    periodStart: source.period_start,
    periodEnd: source.period_end,
  });
  const periodComponents = await listPeriodComponentsForCalculation(client, {
    installationId: source.installation_id,
    payrollPeriodId: source.id,
  });
  return { salaryProfiles, fixedComponents, periodComponents };
}

export async function getCalculationSnapshot(client, {
  installationId, payrollPeriodId, revision,
}) {
  if (!Number.isInteger(Number(revision)) || Number(revision) < 1) return null;
  const result = await client.query(
    `SELECT id, payroll_period_id, revision, source_fingerprint, snapshot,
            issue_summary, request_id, created_by, created_at
       FROM shared.payroll_calculation_snapshots
      WHERE installation_id = $1
        AND payroll_period_id = $2::uuid
        AND revision = $3
      LIMIT 1`,
    [installationId, payrollPeriodId, Number(revision)],
  );
  return result.rows?.[0] ?? null;
}

export async function insertCalculationSnapshot(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.payroll_calculation_snapshots (
       id, installation_id, payroll_period_id, revision, source_fingerprint,
       snapshot, issue_summary, request_id, created_by, created_at
     ) VALUES ($1,$2,$3::uuid,$4,$5,$6::jsonb,$7::jsonb,$8,$9,now())
     RETURNING id, payroll_period_id, revision, source_fingerprint,
       snapshot, issue_summary, request_id, created_by, created_at`,
    [
      id, values.installationId, values.payrollPeriodId, values.revision,
      values.sourceFingerprint, JSON.stringify(values.snapshot),
      JSON.stringify(values.issueSummary), values.requestId, values.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function updatePayrollPeriodAggregation(client, values) {
  const result = await client.query(
    `UPDATE shared.payroll_periods p
        SET status = $3,
            calculation_revision = $4,
            calculation_fingerprint = $5,
            issue_summary = $6::jsonb,
            reconciled_fingerprint = NULL,
            reconciled_by_actor_id = NULL,
            reconciled_at = NULL,
            reconciliation_note = NULL,
            request_id = $7,
            updated_by = $8,
            updated_at = now()
      WHERE p.installation_id = $1 AND p.id = $2::uuid AND p.status <> 'CLOSED'
      RETURNING ${PERIOD_COLUMNS}`,
    [
      values.installationId, values.payrollPeriodId, values.status,
      values.revision, values.sourceFingerprint, JSON.stringify(values.issueSummary),
      values.requestId, values.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function reconcilePayrollPeriod(client, values) {
  const result = await client.query(
    `UPDATE shared.payroll_periods p
        SET status = 'RECONCILED',
            issue_summary = $4::jsonb,
            reconciled_fingerprint = $3,
            reconciled_by_actor_id = $5,
            reconciled_at = now(),
            reconciliation_note = $6,
            request_id = $7,
            updated_by = $5,
            updated_at = now()
      WHERE p.installation_id = $1
        AND p.id = $2::uuid
        AND p.status <> 'CLOSED'
        AND p.calculation_fingerprint = $3
      RETURNING ${PERIOD_COLUMNS}`,
    [
      values.installationId, values.payrollPeriodId, values.sourceFingerprint,
      JSON.stringify(values.issueSummary), values.actorId, values.note, values.requestId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function markPayrollPeriodDirty(client, {
  installationId, payrollPeriodId, actorId, requestId,
}) {
  await client.query(
    `UPDATE shared.payroll_periods
        SET status = CASE WHEN calculation_revision > 0 THEN 'NEEDS_ACTION' ELSE status END,
            calculation_fingerprint = NULL,
            issue_summary = CASE
              WHEN calculation_revision > 0
              THEN '{"blockers":{"sourceChanged":1},"warnings":{}}'::jsonb
              ELSE issue_summary
            END,
            reconciled_fingerprint = NULL,
            reconciled_by_actor_id = NULL,
            reconciled_at = NULL,
            reconciliation_note = NULL,
            request_id = $3,
            updated_by = $4,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2::uuid AND status <> 'CLOSED'`,
    [installationId, payrollPeriodId, requestId, actorId],
  );
}

export async function markPayrollPeriodsDirtyForEmployeeFromDate(client, {
  installationId, employeeId, effectiveFrom, actorId, requestId,
}) {
  await client.query(
    `UPDATE shared.payroll_periods p
        SET status = CASE WHEN p.calculation_revision > 0 THEN 'NEEDS_ACTION' ELSE p.status END,
            calculation_fingerprint = NULL,
            issue_summary = CASE
              WHEN p.calculation_revision > 0
              THEN '{"blockers":{"sourceChanged":1},"warnings":{}}'::jsonb
              ELSE p.issue_summary
            END,
            reconciled_fingerprint = NULL,
            reconciled_by_actor_id = NULL,
            reconciled_at = NULL,
            reconciliation_note = NULL,
            request_id = $4,
            updated_by = $5,
            updated_at = now()
      WHERE p.installation_id = $1
        AND p.status <> 'CLOSED'
        AND p.period_end >= $3::date
        AND EXISTS (
          SELECT 1
            FROM shared.attendance_period_snapshots s
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.snapshot->'employees', '[]'::jsonb)) employee(value)
           WHERE s.installation_id = p.installation_id
             AND s.period_id = p.attendance_period_id
             AND s.revision = p.attendance_revision
             AND employee.value->>'employeeId' = $2
        )`,
    [installationId, employeeId, effectiveFrom, requestId, actorId],
  );
}
