import { randomUUID } from 'node:crypto';

function scopeFilter({ companyScope, branchIds, params, expression }) {
  if (companyScope) return '';
  params.push(Array.isArray(branchIds) ? branchIds : []);
  return ` AND ${expression} = ANY($${params.length}::uuid[])`;
}

export async function listClosedAttendanceSources(client, { installationId, companyScope, branchIds }) {
  const params = [installationId];
  const scope = scopeFilter({ companyScope, branchIds, params, expression: 'p.branch_id' });
  const result = await client.query(
    `SELECT p.id, p.branch_id, p.scope_key,
            to_char(p.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(p.period_end, 'YYYY-MM-DD') AS period_end,
            p.revision, p.source_fingerprint, b.code AS branch_code, b.name AS branch_name
       FROM shared.attendance_periods p
       JOIN shared.attendance_period_snapshots s
         ON s.installation_id = p.installation_id
        AND s.period_id = p.id
        AND s.revision = p.revision
       LEFT JOIN shared.branches b
         ON b.installation_id = p.installation_id AND b.id = p.branch_id
      WHERE p.installation_id = $1
        AND p.status = 'CLOSED'
        AND p.revision >= 1
        AND p.source_fingerprint IS NOT NULL${scope}
      ORDER BY p.period_end DESC, p.period_start DESC, p.scope_key`,
    params,
  );
  return result.rows ?? [];
}

export async function getClosedAttendanceSource(client, { installationId, attendancePeriodId }) {
  const result = await client.query(
    `SELECT p.id, p.branch_id, p.scope_key,
            to_char(p.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(p.period_end, 'YYYY-MM-DD') AS period_end,
            p.status, p.revision, p.source_fingerprint,
            s.id AS snapshot_id
       FROM shared.attendance_periods p
       JOIN shared.attendance_period_snapshots s
         ON s.installation_id = p.installation_id
        AND s.period_id = p.id
        AND s.revision = p.revision
      WHERE p.installation_id = $1 AND p.id = $2::uuid
      LIMIT 1`,
    [installationId, attendancePeriodId],
  );
  return result.rows?.[0] ?? null;
}

export async function findPayrollPeriodByAttendanceSource(client, { installationId, attendancePeriodId, revision }) {
  const result = await client.query(
    `SELECT id FROM shared.payroll_periods
      WHERE installation_id = $1 AND attendance_period_id = $2::uuid AND attendance_revision = $3
      LIMIT 1`,
    [installationId, attendancePeriodId, revision],
  );
  return result.rows?.[0] ?? null;
}

export async function insertPayrollPeriod(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.payroll_periods (
       id, installation_id, attendance_period_id, attendance_revision,
       attendance_source_fingerprint, branch_id, scope_key, period_start, period_end,
       status, currency_code, request_id, created_at, updated_at, created_by, updated_by
     ) VALUES (
       $1,$2,$3::uuid,$4,$5,$6::uuid,$7,$8::date,$9::date,
       'AGGREGATING','VND',$10,now(),now(),$11,$11
     )
     RETURNING id, installation_id, attendance_period_id, attendance_revision,
       attendance_source_fingerprint, branch_id, scope_key,
       to_char(period_start, 'YYYY-MM-DD') AS period_start,
       to_char(period_end, 'YYYY-MM-DD') AS period_end,
       status, currency_code, request_id, created_at, updated_at, created_by, updated_by`,
    [
      id, values.installationId, values.attendancePeriodId, values.attendanceRevision,
      values.sourceFingerprint, values.branchId, values.scopeKey, values.periodStart,
      values.periodEnd, values.requestId, values.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function listPayrollPeriods(client, { installationId, companyScope, branchIds }) {
  const params = [installationId];
  const scope = scopeFilter({ companyScope, branchIds, params, expression: 'p.branch_id' });
  const result = await client.query(
    `SELECT p.id, p.attendance_period_id, p.attendance_revision,
            p.attendance_source_fingerprint, p.branch_id, p.scope_key,
            to_char(p.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(p.period_end, 'YYYY-MM-DD') AS period_end,
            p.status, p.currency_code, p.created_at, p.updated_at,
            b.code AS branch_code, b.name AS branch_name
       FROM shared.payroll_periods p
       LEFT JOIN shared.branches b
         ON b.installation_id = p.installation_id AND b.id = p.branch_id
      WHERE p.installation_id = $1${scope}
      ORDER BY p.period_end DESC, p.period_start DESC, p.scope_key`,
    params,
  );
  return result.rows ?? [];
}

export async function getPayrollPeriodById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT id, installation_id, attendance_period_id, attendance_revision,
            attendance_source_fingerprint, branch_id, scope_key,
            to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end,
            status, currency_code, created_at, updated_at
       FROM shared.payroll_periods
      WHERE installation_id = $1 AND id = $2::uuid
      ${forUpdate ? 'FOR UPDATE' : ''}`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function listPayrollEmployees(client, { installationId, asOfDate, companyScope, branchIds }) {
  const params = [installationId, asOfDate];
  const scope = scopeFilter({ companyScope, branchIds, params, expression: 'a.branch_id' });
  const result = await client.query(
    `SELECT e.id, e.code, e.full_name,
            a.branch_id, b.code AS branch_code, b.name AS branch_name
       FROM shared.employees e
       JOIN shared.employee_employments employment
         ON employment.installation_id = e.installation_id
        AND employment.employee_id = e.id
        AND employment.effective_from <= $2::date
        AND (employment.effective_to IS NULL OR employment.effective_to >= $2::date)
       LEFT JOIN LATERAL (
         SELECT x.branch_id
           FROM shared.employee_assignments x
          WHERE x.installation_id = e.installation_id
            AND x.employee_id = e.id
            AND x.effective_from <= $2::date
            AND (x.effective_to IS NULL OR x.effective_to >= $2::date)
          ORDER BY x.effective_from DESC
          LIMIT 1
       ) a ON true
       LEFT JOIN shared.branches b
         ON b.installation_id = e.installation_id AND b.id = a.branch_id
      WHERE e.installation_id = $1${scope}
      ORDER BY e.full_name, e.code`,
    params,
  );
  return result.rows ?? [];
}

export async function employeeOverlapsPeriod(client, {
  installationId, employeeId, periodStart, periodEnd, branchId = null,
}) {
  const params = [installationId, employeeId, periodStart, periodEnd];
  let assignmentScope = '';
  if (branchId) {
    params.push(branchId);
    assignmentScope = ` AND EXISTS (
      SELECT 1 FROM shared.employee_assignments a
       WHERE a.installation_id = e.installation_id
         AND a.employee_id = e.id
         AND a.effective_from <= $4::date
         AND (a.effective_to IS NULL OR a.effective_to >= $3::date)
         AND a.branch_id = $5::uuid
    )`;
  }
  const result = await client.query(
    `SELECT e.id, e.code, e.full_name
       FROM shared.employees e
      WHERE e.installation_id = $1
        AND e.id = $2::uuid
        AND EXISTS (
          SELECT 1 FROM shared.employee_employments employment
           WHERE employment.installation_id = e.installation_id
             AND employment.employee_id = e.id
             AND employment.effective_from <= $4::date
             AND (employment.effective_to IS NULL OR employment.effective_to >= $3::date)
        )${assignmentScope}
      LIMIT 1`,
    params,
  );
  return result.rows?.[0] ?? null;
}

export async function listSalaryProfiles(client, { installationId, companyScope, branchIds }) {
  const params = [installationId];
  const scope = scopeFilter({ companyScope, branchIds, params, expression: 'a.branch_id' });
  const result = await client.query(
    `SELECT p.id, p.employee_id, e.code AS employee_code, e.full_name AS employee_name,
            p.monthly_salary::text AS monthly_salary, p.currency_code,
            to_char(p.effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(p.effective_to, 'YYYY-MM-DD') AS effective_to,
            p.note, p.created_at, a.branch_id, b.name AS branch_name
       FROM shared.payroll_salary_profiles p
       JOIN shared.employees e
         ON e.installation_id = p.installation_id AND e.id = p.employee_id
       LEFT JOIN LATERAL (
         SELECT x.branch_id FROM shared.employee_assignments x
          WHERE x.installation_id = p.installation_id
            AND x.employee_id = p.employee_id
            AND x.effective_from <= p.effective_from
            AND (x.effective_to IS NULL OR x.effective_to >= p.effective_from)
          ORDER BY x.effective_from DESC LIMIT 1
       ) a ON true
       LEFT JOIN shared.branches b
         ON b.installation_id = p.installation_id AND b.id = a.branch_id
      WHERE p.installation_id = $1${scope}
      ORDER BY e.full_name, p.effective_from DESC`,
    params,
  );
  return result.rows ?? [];
}

export async function getOpenSalaryProfileForUpdate(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT id, employee_id, monthly_salary::text AS monthly_salary,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(effective_to, 'YYYY-MM-DD') AS effective_to, note
       FROM shared.payroll_salary_profiles
      WHERE installation_id = $1 AND employee_id = $2::uuid AND effective_to IS NULL
      ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
    [installationId, employeeId],
  );
  return result.rows?.[0] ?? null;
}

export async function closeSalaryProfile(client, { installationId, id, effectiveTo }) {
  await client.query(
    `UPDATE shared.payroll_salary_profiles SET effective_to = $3::date
      WHERE installation_id = $1 AND id = $2::uuid AND effective_to IS NULL`,
    [installationId, id, effectiveTo],
  );
}

export async function insertSalaryProfile(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.payroll_salary_profiles (
       id, installation_id, employee_id, monthly_salary, currency_code,
       effective_from, effective_to, note, request_id, created_at, created_by
     ) VALUES ($1,$2,$3::uuid,$4::numeric,'VND',$5::date,NULL,$6,$7,now(),$8)
     RETURNING id, employee_id, monthly_salary::text AS monthly_salary, currency_code,
       to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
       to_char(effective_to, 'YYYY-MM-DD') AS effective_to, note, created_at`,
    [id, values.installationId, values.employeeId, values.monthlySalary, values.effectiveFrom, values.note, values.requestId, values.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function listComponentTypes(client, { installationId }) {
  const result = await client.query(
    `SELECT id, code, name, category, recurrence, input_mode,
            prorate_by_workdays, include_in_gross, include_in_net,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(effective_to, 'YYYY-MM-DD') AS effective_to,
            is_active, created_at
       FROM shared.payroll_component_types
      WHERE installation_id = $1
      ORDER BY is_active DESC, category, name, effective_from DESC`,
    [installationId],
  );
  return result.rows ?? [];
}

export async function getComponentTypeById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT id, code, name, category, recurrence, input_mode,
            prorate_by_workdays, include_in_gross, include_in_net,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(effective_to, 'YYYY-MM-DD') AS effective_to,
            is_active
       FROM shared.payroll_component_types
      WHERE installation_id = $1 AND id = $2::uuid
      LIMIT 1`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function findOpenComponentTypeByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT id FROM shared.payroll_component_types
      WHERE installation_id = $1 AND code = $2 AND effective_to IS NULL
      LIMIT 1`,
    [installationId, code],
  );
  return result.rows?.[0] ?? null;
}

export async function insertComponentType(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.payroll_component_types (
       id, installation_id, code, name, category, recurrence, input_mode,
       prorate_by_workdays, include_in_gross, include_in_net,
       effective_from, effective_to, is_active, request_id, created_at, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,NULL,true,$12,now(),$13
     )
     RETURNING id, code, name, category, recurrence, input_mode,
       prorate_by_workdays, include_in_gross, include_in_net,
       to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
       to_char(effective_to, 'YYYY-MM-DD') AS effective_to, is_active, created_at`,
    [
      id, values.installationId, values.code, values.name, values.category, values.recurrence,
      values.inputMode, values.prorateByWorkdays, values.includeInGross, values.includeInNet,
      values.effectiveFrom, values.requestId, values.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function listFixedComponents(client, { installationId, companyScope, branchIds }) {
  const params = [installationId];
  const scope = scopeFilter({ companyScope, branchIds, params, expression: 'a.branch_id' });
  const result = await client.query(
    `SELECT f.id, f.employee_id, e.code AS employee_code, e.full_name AS employee_name,
            f.component_type_id, t.code AS component_code, t.name AS component_name,
            t.category, f.amount::text AS amount,
            to_char(f.effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(f.effective_to, 'YYYY-MM-DD') AS effective_to,
            f.note, a.branch_id, b.name AS branch_name
       FROM shared.payroll_employee_fixed_components f
       JOIN shared.employees e
         ON e.installation_id = f.installation_id AND e.id = f.employee_id
       JOIN shared.payroll_component_types t
         ON t.installation_id = f.installation_id AND t.id = f.component_type_id
       LEFT JOIN LATERAL (
         SELECT x.branch_id FROM shared.employee_assignments x
          WHERE x.installation_id = f.installation_id
            AND x.employee_id = f.employee_id
            AND x.effective_from <= f.effective_from
            AND (x.effective_to IS NULL OR x.effective_to >= f.effective_from)
          ORDER BY x.effective_from DESC LIMIT 1
       ) a ON true
       LEFT JOIN shared.branches b
         ON b.installation_id = f.installation_id AND b.id = a.branch_id
      WHERE f.installation_id = $1${scope}
      ORDER BY e.full_name, t.name, f.effective_from DESC`,
    params,
  );
  return result.rows ?? [];
}

export async function getOpenFixedComponentForUpdate(client, { installationId, employeeId, componentTypeId }) {
  const result = await client.query(
    `SELECT id, employee_id, component_type_id, amount::text AS amount,
            to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(effective_to, 'YYYY-MM-DD') AS effective_to, note
       FROM shared.payroll_employee_fixed_components
      WHERE installation_id = $1 AND employee_id = $2::uuid
        AND component_type_id = $3::uuid AND effective_to IS NULL
      ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,
    [installationId, employeeId, componentTypeId],
  );
  return result.rows?.[0] ?? null;
}

export async function closeFixedComponent(client, { installationId, id, effectiveTo }) {
  await client.query(
    `UPDATE shared.payroll_employee_fixed_components SET effective_to = $3::date
      WHERE installation_id = $1 AND id = $2::uuid AND effective_to IS NULL`,
    [installationId, id, effectiveTo],
  );
}

export async function insertFixedComponent(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.payroll_employee_fixed_components (
       id, installation_id, employee_id, component_type_id, amount,
       effective_from, effective_to, note, request_id, created_at, created_by
     ) VALUES ($1,$2,$3::uuid,$4::uuid,$5::numeric,$6::date,NULL,$7,$8,now(),$9)
     RETURNING id, employee_id, component_type_id, amount::text AS amount,
       to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
       to_char(effective_to, 'YYYY-MM-DD') AS effective_to, note, created_at`,
    [id, values.installationId, values.employeeId, values.componentTypeId, values.amount, values.effectiveFrom, values.note, values.requestId, values.actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function listPeriodComponents(client, { installationId, payrollPeriodId = null }) {
  const params = [installationId];
  let period = '';
  if (payrollPeriodId) {
    params.push(payrollPeriodId);
    period = ` AND c.payroll_period_id = $${params.length}::uuid`;
  }
  const result = await client.query(
    `SELECT c.id, c.payroll_period_id, c.employee_id,
            e.code AS employee_code, e.full_name AS employee_name,
            c.component_type_id, t.code AS component_code, t.name AS component_name,
            t.category, c.amount::text AS amount, c.note, c.source, c.source_reference,
            c.created_at
       FROM shared.payroll_period_components c
       JOIN shared.employees e
         ON e.installation_id = c.installation_id AND e.id = c.employee_id
       JOIN shared.payroll_component_types t
         ON t.installation_id = c.installation_id AND t.id = c.component_type_id
      WHERE c.installation_id = $1${period}
      ORDER BY c.created_at DESC, c.id DESC`,
    params,
  );
  return result.rows ?? [];
}

export async function insertPeriodComponent(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.payroll_period_components (
       id, installation_id, payroll_period_id, employee_id, component_type_id,
       amount, note, source, source_reference, request_id, created_at, created_by
     ) VALUES ($1,$2,$3::uuid,$4::uuid,$5::uuid,$6::numeric,$7,'MANUAL',NULL,$8,now(),$9)
     RETURNING id, payroll_period_id, employee_id, component_type_id,
       amount::text AS amount, note, source, source_reference, created_at`,
    [id, values.installationId, values.payrollPeriodId, values.employeeId, values.componentTypeId, values.amount, values.note, values.requestId, values.actorId],
  );
  return result.rows?.[0] ?? null;
}
