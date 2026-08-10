import * as accessUserService from '../src/services/access-users.js';

const LOGIN_PATTERN = /^[a-z0-9._-]+$/;

function failure(code) {
  return { ok: false, code, statusCode: 409 };
}

function normalizeEmails(emails) {
  if (!Array.isArray(emails)) return null;
  const normalized = emails.map((email) => String(email ?? '').trim().toLowerCase()).filter(Boolean);
  if (normalized.length !== emails.length || new Set(normalized).size !== normalized.length) return null;
  return normalized;
}

function ownerLoginName(employeeCode) {
  const loginName = String(employeeCode ?? '').trim().toLowerCase();
  return loginName.length > 0 && loginName.length <= 128 && LOGIN_PATTERN.test(loginName)
    ? loginName
    : null;
}

export async function ensureSecurityOwnerUsers(client, {
  installationId,
  emails,
  actorId,
  userService = accessUserService,
}) {
  const normalizedEmails = normalizeEmails(emails);
  if (!normalizedEmails?.length) return failure('SECURITY_OWNER_EMAILS_INVALID');

  const result = await client.query(
    `SELECT
       lower(e.email) AS email,
       e.id AS employee_id,
       e.code AS employee_code,
       e.is_active AS employee_is_active,
       u.id AS user_id,
       u.is_active AS user_is_active
     FROM shared.employees e
     LEFT JOIN shared.users u
       ON u.installation_id = e.installation_id
      AND u.employee_id = e.id
     WHERE e.installation_id = $1
       AND lower(e.email) = ANY($2::text[])
     ORDER BY lower(e.email), e.id`,
    [installationId, normalizedEmails],
  );

  const byEmail = new Map();
  for (const row of result.rows ?? []) {
    const email = String(row.email ?? '').toLowerCase();
    const rows = byEmail.get(email) ?? [];
    rows.push(row);
    byEmail.set(email, rows);
  }

  let provisionedUserCount = 0;
  for (const email of normalizedEmails) {
    const rows = byEmail.get(email) ?? [];
    if (rows.length === 0) return failure('SECURITY_OWNER_EMPLOYEE_NOT_FOUND');
    if (rows.length !== 1) return failure('SECURITY_OWNER_IDENTITY_AMBIGUOUS');

    const row = rows[0];
    if (!row.employee_is_active) return failure('SECURITY_OWNER_EMPLOYEE_INACTIVE');
    if (row.user_id) {
      if (!row.user_is_active) return failure('SECURITY_OWNER_USER_INACTIVE');
      continue;
    }

    const loginName = ownerLoginName(row.employee_code);
    if (!loginName) return failure('SECURITY_OWNER_LOGIN_NAME_INVALID');

    const created = await userService.createUser(client, {
      installationId,
      payload: {
        employeeId: String(row.employee_id),
        loginName,
        isActive: true,
      },
      createdBy: actorId,
    });
    if (!created?.ok) {
      if (created?.code === 'DUPLICATE_LOGIN') return failure('SECURITY_OWNER_LOGIN_CONFLICT');
      if (created?.code === 'DUPLICATE_EMPLOYEE') return failure('SECURITY_OWNER_IDENTITY_CONFLICT');
      if (created?.code === 'INVALID_EMPLOYEE_ID') return failure('SECURITY_OWNER_EMPLOYEE_INACTIVE');
      return failure('SECURITY_OWNER_USER_PROVISION_FAILED');
    }
    if (!created.user?.id || created.user.is_active === false) {
      return failure('SECURITY_OWNER_USER_PROVISION_FAILED');
    }
    provisionedUserCount += 1;
  }

  return {
    ok: true,
    ownerCount: normalizedEmails.length,
    provisionedUserCount,
  };
}
