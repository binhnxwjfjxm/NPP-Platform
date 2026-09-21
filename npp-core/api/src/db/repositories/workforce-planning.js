import { randomUUID } from 'node:crypto';

const SHIFT_COLUMNS = `id, installation_id, code, name,
  start_time::text AS start_time, end_time::text AS end_time, break_minutes, is_active,
  created_at, updated_at, created_by, updated_by`;

const WEEK_COLUMNS = `id, installation_id, code, name, is_active,
  created_at, updated_at, created_by, updated_by`;

const CALENDAR_COLUMNS = `id, installation_id,
  to_char(calendar_date, 'YYYY-MM-DD') AS calendar_date,
  calendar_kind, name, is_active, created_at, updated_at, created_by, updated_by`;

export async function listShiftTemplates(client, { installationId }) {
  const result = await client.query(
    `SELECT ${SHIFT_COLUMNS}
       FROM shared.work_shift_templates
      WHERE installation_id = $1
      ORDER BY is_active DESC, code ASC`,
    [installationId],
  );
  return result.rows ?? [];
}

export async function getShiftTemplateById(client, { installationId, id }) {
  const result = await client.query(
    `SELECT ${SHIFT_COLUMNS}
       FROM shared.work_shift_templates
      WHERE installation_id = $1 AND id = $2`,
    [installationId, id],
  );
  return result.rows?.[0] ?? null;
}

export async function getShiftTemplateByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${SHIFT_COLUMNS}
       FROM shared.work_shift_templates
      WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );
  return result.rows?.[0] ?? null;
}

export async function saveShiftTemplate(client, values) {
  if (values.id) {
    const result = await client.query(
      `UPDATE shared.work_shift_templates
          SET code = $3, name = $4, start_time = $5, end_time = $6,
              break_minutes = $7, is_active = $8,
              updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
              updated_by = $9
        WHERE installation_id = $1 AND id = $2
        RETURNING ${SHIFT_COLUMNS}`,
      [
        values.installationId, values.id, values.code, values.name,
        values.startTime, values.endTime, values.breakMinutes, values.isActive, values.actorId,
      ],
    );
    return result.rows?.[0] ?? null;
  }
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.work_shift_templates (
       id, installation_id, code, name, start_time, end_time, break_minutes, is_active,
       created_at, updated_at, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now(),$9,$9)
     RETURNING ${SHIFT_COLUMNS}`,
    [
      id, values.installationId, values.code, values.name,
      values.startTime, values.endTime, values.breakMinutes, values.isActive, values.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function listWeekTemplates(client, { installationId }) {
  const templates = await client.query(
    `SELECT ${WEEK_COLUMNS}
       FROM shared.work_week_templates
      WHERE installation_id = $1
      ORDER BY is_active DESC, code ASC`,
    [installationId],
  );
  const days = await client.query(
    `SELECT d.id, d.installation_id, d.week_template_id, d.weekday, d.schedule_kind,
            d.shift_template_id, s.code AS shift_code, s.name AS shift_name,
            s.start_time::text AS shift_start_time, s.end_time::text AS shift_end_time,
            s.break_minutes AS shift_break_minutes
       FROM shared.work_week_template_days d
       LEFT JOIN shared.work_shift_templates s
         ON s.installation_id = d.installation_id AND s.id = d.shift_template_id
      WHERE d.installation_id = $1
      ORDER BY d.week_template_id, d.weekday`,
    [installationId],
  );
  const byTemplate = new Map();
  for (const day of days.rows ?? []) {
    const bucket = byTemplate.get(day.week_template_id) ?? [];
    bucket.push(day);
    byTemplate.set(day.week_template_id, bucket);
  }
  return (templates.rows ?? []).map((template) => ({
    ...template,
    days: byTemplate.get(template.id) ?? [],
  }));
}

export async function getWeekTemplateById(client, { installationId, id }) {
  const templates = await listWeekTemplates(client, { installationId });
  return templates.find((template) => template.id === id) ?? null;
}

export async function getWeekTemplateByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${WEEK_COLUMNS}
       FROM shared.work_week_templates
      WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );
  return result.rows?.[0] ?? null;
}

export async function saveWeekTemplate(client, values) {
  let id = values.id;
  if (id) {
    const updated = await client.query(
      `UPDATE shared.work_week_templates
          SET code = $3, name = $4, is_active = $5,
              updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
              updated_by = $6
        WHERE installation_id = $1 AND id = $2
        RETURNING id`,
      [values.installationId, id, values.code, values.name, values.isActive, values.actorId],
    );
    if (!updated.rows?.[0]) return null;
  } else {
    id = randomUUID();
    await client.query(
      `INSERT INTO shared.work_week_templates (
         id, installation_id, code, name, is_active, created_at, updated_at, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,now(),now(),$6,$6)`,
      [id, values.installationId, values.code, values.name, values.isActive, values.actorId],
    );
  }

  await client.query(
    `DELETE FROM shared.work_week_template_days
      WHERE installation_id = $1 AND week_template_id = $2`,
    [values.installationId, id],
  );
  for (const day of values.days) {
    await client.query(
      `INSERT INTO shared.work_week_template_days (
         id, installation_id, week_template_id, weekday, schedule_kind, shift_template_id,
         created_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,now(),$7)`,
      [
        randomUUID(), values.installationId, id, day.weekday, day.scheduleKind,
        day.shiftTemplateId, values.actorId,
      ],
    );
  }
  return getWeekTemplateById(client, { installationId: values.installationId, id });
}

export async function listCalendarDays(client, { installationId }) {
  const result = await client.query(
    `SELECT ${CALENDAR_COLUMNS}
       FROM shared.company_calendar_days
      WHERE installation_id = $1
      ORDER BY calendar_date DESC
      LIMIT 500`,
    [installationId],
  );
  return result.rows ?? [];
}

export async function getCalendarDayByDate(client, { installationId, calendarDate }) {
  const result = await client.query(
    `SELECT ${CALENDAR_COLUMNS}
       FROM shared.company_calendar_days
      WHERE installation_id = $1 AND calendar_date = $2`,
    [installationId, calendarDate],
  );
  return result.rows?.[0] ?? null;
}

export async function saveCalendarDay(client, values) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.company_calendar_days (
       id, installation_id, calendar_date, calendar_kind, name, is_active,
       created_at, updated_at, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,now(),now(),$7,$7)
     ON CONFLICT (installation_id, calendar_date) DO UPDATE
       SET calendar_kind = EXCLUDED.calendar_kind,
           name = EXCLUDED.name,
           is_active = EXCLUDED.is_active,
           updated_at = GREATEST(
             date_trunc('milliseconds', clock_timestamp()),
             shared.company_calendar_days.updated_at + interval '1 millisecond'
           ),
           updated_by = EXCLUDED.updated_by
     RETURNING ${CALENDAR_COLUMNS}`,
    [
      id, values.installationId, values.calendarDate, values.calendarKind,
      values.name, values.isActive, values.actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function listEmployeesByIds(client, { installationId, employeeIds }) {
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) return [];
  const result = await client.query(
    `SELECT id, code, full_name, branch_id, is_active
       FROM shared.employees
      WHERE installation_id = $1 AND id = ANY($2::uuid[])
      ORDER BY code ASC`,
    [installationId, employeeIds],
  );
  return result.rows ?? [];
}

export async function listPolicyAssignmentsForEmployees(client, {
  installationId, employeeIds, dateFrom, dateTo,
}) {
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) return [];
  const result = await client.query(
    `SELECT a.employee_id, a.work_policy_id,
            to_char(a.effective_from, 'YYYY-MM-DD') AS effective_from,
            CASE WHEN a.effective_to IS NULL THEN NULL ELSE to_char(a.effective_to, 'YYYY-MM-DD') END AS effective_to,
            p.code AS policy_code, p.name AS policy_name, p.timezone AS policy_timezone,
            to_char(p.effective_from, 'YYYY-MM-DD') AS policy_effective_from,
            CASE WHEN p.effective_to IS NULL THEN NULL ELSE to_char(p.effective_to, 'YYYY-MM-DD') END AS policy_effective_to
       FROM shared.employee_work_policy_assignments a
       JOIN shared.work_policies p
         ON p.installation_id = a.installation_id AND p.id = a.work_policy_id
      WHERE a.installation_id = $1
        AND a.employee_id = ANY($2::uuid[])
        AND a.effective_from <= $4::date
        AND (a.effective_to IS NULL OR a.effective_to >= $3::date)
        AND p.effective_from <= $4::date
        AND (p.effective_to IS NULL OR p.effective_to >= $3::date)
        AND p.is_active = true
      ORDER BY a.employee_id, a.effective_from DESC`,
    [installationId, employeeIds, dateFrom, dateTo],
  );
  return result.rows ?? [];
}

export async function listActiveCalendarDaysForRange(client, { installationId, dateFrom, dateTo }) {
  const result = await client.query(
    `SELECT ${CALENDAR_COLUMNS}
       FROM shared.company_calendar_days
      WHERE installation_id = $1
        AND is_active = true
        AND calendar_date BETWEEN $2::date AND $3::date
      ORDER BY calendar_date ASC`,
    [installationId, dateFrom, dateTo],
  );
  return result.rows ?? [];
}

export async function upsertPlannedSchedules(client, { installationId, rows, actorId }) {
  if (!Array.isArray(rows) || rows.length === 0) return { written: 0, scheduleIds: [] };
  const result = await client.query(
    `INSERT INTO shared.work_schedules AS existing (
       id, installation_id, employee_id, work_policy_id, work_date, schedule_kind,
       scheduled_start_at, scheduled_end_at, source, override_reason,
       shift_template_id, week_template_id, company_calendar_day_id,
       created_at, updated_at, created_by, updated_by
     )
     SELECT gen_random_uuid(), $1, x.employee_id::uuid, NULLIF(x.work_policy_id, '')::uuid,
            x.work_date::date, x.schedule_kind,
            NULLIF(x.scheduled_start_at, '')::timestamptz,
            NULLIF(x.scheduled_end_at, '')::timestamptz,
            'POLICY', NULL,
            NULLIF(x.shift_template_id, '')::uuid,
            NULLIF(x.week_template_id, '')::uuid,
            NULLIF(x.company_calendar_day_id, '')::uuid,
            now(), now(), $3, $3
       FROM jsonb_to_recordset($2::jsonb) AS x(
         employee_id text,
         work_policy_id text,
         work_date text,
         schedule_kind text,
         scheduled_start_at text,
         scheduled_end_at text,
         shift_template_id text,
         week_template_id text,
         company_calendar_day_id text
       )
     ON CONFLICT (installation_id, employee_id, work_date) DO UPDATE
       SET work_policy_id = EXCLUDED.work_policy_id,
           schedule_kind = EXCLUDED.schedule_kind,
           scheduled_start_at = EXCLUDED.scheduled_start_at,
           scheduled_end_at = EXCLUDED.scheduled_end_at,
           source = 'POLICY',
           override_reason = NULL,
           shift_template_id = EXCLUDED.shift_template_id,
           week_template_id = EXCLUDED.week_template_id,
           company_calendar_day_id = EXCLUDED.company_calendar_day_id,
           updated_at = GREATEST(
             date_trunc('milliseconds', clock_timestamp()),
             existing.updated_at + interval '1 millisecond'
           ),
           updated_by = EXCLUDED.updated_by
       WHERE existing.source <> 'OVERRIDE'
     RETURNING id`,
    [installationId, JSON.stringify(rows), actorId],
  );
  return {
    written: result.rowCount ?? 0,
    scheduleIds: (result.rows ?? []).map((row) => row.id),
  };
}

export async function listSchedulesForCopy(client, {
  installationId, employeeIds, dateFrom, dateTo,
}) {
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) return [];
  const result = await client.query(
    `SELECT s.id, s.employee_id, s.work_policy_id,
            to_char(s.work_date, 'YYYY-MM-DD') AS work_date,
            s.schedule_kind, s.scheduled_start_at, s.scheduled_end_at,
            s.source, s.override_reason, s.shift_template_id, p.timezone AS policy_timezone
       FROM shared.work_schedules s
       LEFT JOIN shared.work_policies p
         ON p.installation_id = s.installation_id AND p.id = s.work_policy_id
      WHERE s.installation_id = $1
        AND s.employee_id = ANY($2::uuid[])
        AND s.work_date BETWEEN $3::date AND $4::date
      ORDER BY s.employee_id, s.work_date`,
    [installationId, employeeIds, dateFrom, dateTo],
  );
  return result.rows ?? [];
}
