export async function findLoginIdentity(client, { installationId, loginName }) {
  const result = await client.query(
    `SELECT
       u.id AS user_id,
       u.login_name,
       u.is_active AS user_is_active,
       e.id AS employee_id,
       e.full_name AS employee_full_name,
       e.email AS employee_email,
       e.branch_id AS employee_branch_id,
       e.is_active AS employee_is_active,
       c.password_hash,
       c.failed_attempts,
       c.locked_until
     FROM shared.users u
     JOIN shared.employees e
       ON e.installation_id = u.installation_id
      AND e.id = u.employee_id
     LEFT JOIN shared.user_credentials c
       ON c.installation_id = u.installation_id
      AND c.user_id = u.id
     LEFT JOIN shared.security_owner_bindings ob
       ON ob.installation_id = u.installation_id
      AND ob.user_id = u.id
     WHERE u.installation_id = $1
       AND (
         u.login_name = $2
         OR (ob.user_id IS NOT NULL AND lower(e.email) = lower($2))
       )
     ORDER BY CASE WHEN u.login_name = $2 THEN 0 ELSE 1 END, u.id
     LIMIT 2`,
    [installationId, loginName],
  );
  return result.rows?.length === 1 ? result.rows[0] : null;
}

export async function lockCredentialForLogin(client, { installationId, userId }) {
  const result = await client.query(
    `SELECT password_hash, failed_attempts, locked_until
     FROM shared.user_credentials
     WHERE installation_id = $1 AND user_id = $2
     FOR UPDATE`,
    [installationId, userId],
  );
  return result.rows?.[0] ?? null;
}

export async function recordPasswordFailure(client, {
  installationId,
  userId,
  lockThreshold,
  lockSeconds,
}) {
  const result = await client.query(
    `UPDATE shared.user_credentials
     SET failed_attempts = LEAST(failed_attempts + 1, 100),
         locked_until = CASE
           WHEN failed_attempts + 1 >= $3 THEN now() + ($4::text || ' seconds')::interval
           ELSE locked_until
         END,
         updated_at = now()
     WHERE installation_id = $1 AND user_id = $2
     RETURNING failed_attempts, locked_until`,
    [installationId, userId, lockThreshold, lockSeconds],
  );
  return result.rows?.[0] ?? null;
}

export async function resetPasswordFailures(client, { installationId, userId, updatedBy }) {
  await client.query(
    `UPDATE shared.user_credentials
     SET failed_attempts = 0,
         locked_until = NULL,
         updated_at = now(),
         updated_by = $3
     WHERE installation_id = $1 AND user_id = $2`,
    [installationId, userId, updatedBy],
  );
}

export async function upsertCredential(client, {
  installationId,
  userId,
  passwordHash,
  actorId,
}) {
  const result = await client.query(
    `INSERT INTO shared.user_credentials (
       installation_id, user_id, password_hash, failed_attempts, locked_until,
       created_at, updated_at, created_by, updated_by
     ) VALUES ($1, $2, $3, 0, NULL, now(), now(), $4, $4)
     ON CONFLICT (installation_id, user_id) DO UPDATE
     SET password_hash = EXCLUDED.password_hash,
         failed_attempts = 0,
         locked_until = NULL,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by
     RETURNING installation_id, user_id, updated_at`,
    [installationId, userId, passwordHash, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function insertSession(client, {
  sessionId,
  installationId,
  userId,
  tokenHash,
  sourceApp,
  expiresAt,
}) {
  const result = await client.query(
    `INSERT INTO shared.user_sessions (
       id, installation_id, user_id, token_hash, source_app, access_channel,
       created_at, expires_at, revoked_at, revoked_by
     ) VALUES ($1, $2, $3, $4, $5, 'WEB', now(), $6, NULL, NULL)
     RETURNING id, user_id, source_app, access_channel, created_at, expires_at`,
    [sessionId, installationId, userId, tokenHash, sourceApp, expiresAt],
  );
  return result.rows?.[0] ?? null;
}

export async function findActiveSession(client, {
  sessionId,
  installationId,
  tokenHash,
}) {
  const result = await client.query(
    `SELECT
       s.id AS session_id,
       s.user_id,
       s.source_app,
       s.access_channel,
       s.created_at,
       s.expires_at,
       s.revoked_at,
       u.login_name,
       u.is_active AS user_is_active,
       e.id AS employee_id,
       e.full_name AS employee_full_name,
       e.branch_id AS employee_branch_id,
       e.is_active AS employee_is_active
     FROM shared.user_sessions s
     JOIN shared.users u
       ON u.installation_id = s.installation_id
      AND u.id = s.user_id
     JOIN shared.employees e
       ON e.installation_id = u.installation_id
      AND e.id = u.employee_id
     WHERE s.id = $1
       AND s.installation_id = $2
       AND s.token_hash = $3`,
    [sessionId, installationId, tokenHash],
  );
  return result.rows?.[0] ?? null;
}

export async function revokeSession(client, {
  sessionId,
  installationId,
  userId,
  revokedBy,
}) {
  const result = await client.query(
    `UPDATE shared.user_sessions
     SET revoked_at = COALESCE(revoked_at, now()),
         revoked_by = COALESCE(revoked_by, $4)
     WHERE id = $1 AND installation_id = $2 AND user_id = $3
     RETURNING id, revoked_at, revoked_by`,
    [sessionId, installationId, userId, revokedBy],
  );
  return result.rows?.[0] ?? null;
}

export async function revokeAllUserSessions(client, {
  installationId,
  userId,
  revokedBy,
}) {
  const result = await client.query(
    `UPDATE shared.user_sessions
     SET revoked_at = COALESCE(revoked_at, now()),
         revoked_by = COALESCE(revoked_by, $3)
     WHERE installation_id = $1
       AND user_id = $2
       AND revoked_at IS NULL
     RETURNING id`,
    [installationId, userId, revokedBy],
  );
  return result.rows?.length ?? 0;
}

export async function loadUserAuthorization(client, { installationId, userId }) {
  const [rolesResult, scopesResult, ownerResult] = await Promise.all([
    client.query(
      `SELECT
         r.code AS role_code,
         r.web_login_challenge_required,
         rp.permission_key
       FROM shared.user_roles ur
       JOIN shared.roles r
         ON r.installation_id = ur.installation_id
        AND r.id = ur.role_id
        AND r.is_active = true
       LEFT JOIN shared.role_permissions rp
         ON rp.installation_id = r.installation_id
        AND rp.role_id = r.id
       WHERE ur.installation_id = $1 AND ur.user_id = $2
       ORDER BY r.code, rp.permission_key`,
      [installationId, userId],
    ),
    client.query(
      `SELECT scope_type, scope_id
       FROM shared.user_scopes
       WHERE installation_id = $1 AND user_id = $2
       ORDER BY scope_type, scope_id`,
      [installationId, userId],
    ),
    client.query(
      `SELECT owner_kind
       FROM shared.security_owner_bindings
       WHERE installation_id = $1 AND user_id = $2`,
      [installationId, userId],
    ),
  ]);

  const roles = [];
  const permissionKeys = [];
  let webLoginChallengeRequired = false;
  for (const row of rolesResult.rows ?? []) {
    if (row.role_code && !roles.includes(String(row.role_code))) roles.push(String(row.role_code));
    if (row.web_login_challenge_required === true) webLoginChallengeRequired = true;
    if (row.permission_key && !permissionKeys.includes(String(row.permission_key))) {
      permissionKeys.push(String(row.permission_key));
    }
  }

  const scopes = { branchIds: [], warehouseIds: [], territoryIds: [] };
  for (const row of scopesResult.rows ?? []) {
    const id = String(row.scope_id);
    if (row.scope_type === 'BRANCH') scopes.branchIds.push(id);
    if (row.scope_type === 'WAREHOUSE') scopes.warehouseIds.push(id);
    if (row.scope_type === 'TERRITORY') scopes.territoryIds.push(id);
  }

  return {
    roles,
    permissionKeys,
    scopes,
    ownerKind: ownerResult.rows?.[0]?.owner_kind ?? null,
    webLoginChallengeRequired,
  };
}

export async function loadInstallationOwnerScopes(client, { installationId }) {
  // Installation-wide authorization includes inactive org records so historical documents
  // remain visible after a branch or warehouse is retired.
  const [branches, warehouses] = await Promise.all([
    client.query(
      `SELECT id FROM shared.branches
       WHERE installation_id = $1
       ORDER BY id`,
      [installationId],
    ),
    client.query(
      `SELECT id FROM shared.warehouses
       WHERE installation_id = $1
       ORDER BY id`,
      [installationId],
    ),
  ]);
  return {
    branchIds: (branches.rows ?? []).map((row) => String(row.id)),
    warehouseIds: (warehouses.rows ?? []).map((row) => String(row.id)),
  };
}

export async function replaceUserScopes(client, {
  installationId,
  userId,
  scopes,
  createdBy,
}) {
  await client.query(
    `DELETE FROM shared.user_scopes
     WHERE installation_id = $1 AND user_id = $2`,
    [installationId, userId],
  );

  const rows = [];
  for (const scopeId of scopes.branchIds) rows.push(['BRANCH', scopeId]);
  for (const scopeId of scopes.warehouseIds) rows.push(['WAREHOUSE', scopeId]);
  for (const scopeId of scopes.territoryIds) rows.push(['TERRITORY', scopeId]);
  if (rows.length === 0) return;

  const values = [installationId, userId, createdBy];
  const tuples = rows.map(([scopeType, scopeId], index) => {
    values.push(scopeType, scopeId);
    const offset = 4 + (index * 2);
    return `($1, $2, $${offset}, $${offset + 1}::uuid, now(), $3)`;
  });
  await client.query(
    `INSERT INTO shared.user_scopes (
       installation_id, user_id, scope_type, scope_id, created_at, created_by
     ) VALUES ${tuples.join(', ')}`,
    values,
  );
}

export async function userExistsForInstallation(client, { installationId, userId }) {
  const result = await client.query(
    `SELECT 1
     FROM shared.users u
     JOIN shared.employees e
       ON e.installation_id = u.installation_id AND e.id = u.employee_id
     WHERE u.installation_id = $1 AND u.id = $2
       AND e.is_active = true`,
    [installationId, userId],
  );
  return Boolean(result.rows?.[0]);
}

export async function getSecurityOwnerBindingForUser(client, { installationId, userId }) {
  const result = await client.query(
    `SELECT user_id, owner_kind
     FROM shared.security_owner_bindings
     WHERE installation_id = $1 AND user_id = $2`,
    [installationId, userId],
  );
  return result.rows?.[0] ?? null;
}

export async function getSecurityOwnerBindingForEmployee(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT b.user_id, b.owner_kind
     FROM shared.security_owner_bindings b
     JOIN shared.users u
       ON u.installation_id = b.installation_id
      AND u.id = b.user_id
     WHERE b.installation_id = $1 AND u.employee_id = $2`,
    [installationId, employeeId],
  );
  return result.rows?.[0] ?? null;
}

export async function findOwnerCandidatesByEmails(client, { installationId, emails }) {
  if (!emails.length) return [];
  const result = await client.query(
    `SELECT
       lower(e.email) AS email,
       u.id AS user_id,
       u.is_active AS user_is_active,
       e.is_active AS employee_is_active
     FROM shared.employees e
     JOIN shared.users u
       ON u.installation_id = e.installation_id
      AND u.employee_id = e.id
     WHERE e.installation_id = $1
       AND lower(e.email) = ANY($2::text[])
     ORDER BY lower(e.email), u.id`,
    [installationId, emails],
  );
  return result.rows ?? [];
}

export async function listSecurityOwnerBindings(client, { installationId }) {
  const result = await client.query(
    `SELECT user_id, owner_kind
     FROM shared.security_owner_bindings
     WHERE installation_id = $1
     ORDER BY owner_kind, user_id`,
    [installationId],
  );
  return result.rows ?? [];
}

export async function replaceSecurityOwnerBindings(client, {
  installationId,
  bindings,
  actorId,
}) {
  await client.query(
    `DELETE FROM shared.security_owner_bindings
     WHERE installation_id = $1`,
    [installationId],
  );
  if (!bindings.length) return;

  const values = [installationId, actorId];
  const tuples = bindings.map((binding, index) => {
    values.push(binding.userId, binding.ownerKind);
    const offset = 3 + (index * 2);
    return `($1, $${offset}::uuid, $${offset + 1}, now(), now(), $2, $2)`;
  });
  await client.query(
    `INSERT INTO shared.security_owner_bindings (
       installation_id, user_id, owner_kind, created_at, updated_at, created_by, updated_by
     ) VALUES ${tuples.join(', ')}`,
    values,
  );
}

export async function validateUserScopeIds(client, { installationId, scopes }) {
  // A retired branch/warehouse remains a valid authorization scope for historical data.
  // The installation boundary is the security boundary; operational activity is separate.
  const branchIds = [...new Set(scopes.branchIds)];
  const warehouseIds = [...new Set(scopes.warehouseIds)];
  const [branches, warehouses] = await Promise.all([
    branchIds.length
      ? client.query(
          `SELECT id FROM shared.branches
           WHERE installation_id = $1 AND id = ANY($2::uuid[])`,
          [installationId, branchIds],
        )
      : Promise.resolve({ rows: [] }),
    warehouseIds.length
      ? client.query(
          `SELECT id FROM shared.warehouses
           WHERE installation_id = $1 AND id = ANY($2::uuid[])`,
          [installationId, warehouseIds],
        )
      : Promise.resolve({ rows: [] }),
  ]);
  const foundBranches = new Set((branches.rows ?? []).map((row) => String(row.id)));
  const foundWarehouses = new Set((warehouses.rows ?? []).map((row) => String(row.id)));
  return {
    missingBranchIds: branchIds.filter((id) => !foundBranches.has(id)),
    missingWarehouseIds: warehouseIds.filter((id) => !foundWarehouses.has(id)),
  };
}

export async function findActiveLoginChallengeForUpdate(client, { installationId, userId, sourceApp }) {
  const result = await client.query(
    `SELECT id, code_hash, source_app, created_at, expires_at, failed_attempts, consumed_at, cancelled_at
     FROM shared.internal_login_challenges
     WHERE installation_id = $1
       AND user_id = $2
       AND source_app = $3
       AND consumed_at IS NULL
       AND cancelled_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [installationId, userId, sourceApp],
  );
  return result.rows?.[0] ?? null;
}

export async function cancelActiveLoginChallenges(client, { installationId, userId, sourceApp }) {
  await client.query(
    `UPDATE shared.internal_login_challenges
     SET cancelled_at = COALESCE(cancelled_at, now())
     WHERE installation_id = $1
       AND user_id = $2
       AND source_app = $3
       AND consumed_at IS NULL
       AND cancelled_at IS NULL`,
    [installationId, userId, sourceApp],
  );
}

export async function insertLoginChallenge(client, {
  id,
  installationId,
  userId,
  codeHash,
  sourceApp,
  expiresAt,
}) {
  const result = await client.query(
    `INSERT INTO shared.internal_login_challenges (
       id, installation_id, user_id, code_hash, source_app, created_at, expires_at,
       failed_attempts, consumed_at, cancelled_at
     ) VALUES ($1, $2, $3, $4, $5, now(), $6, 0, NULL, NULL)
     RETURNING id, source_app, created_at, expires_at, failed_attempts`,
    [id, installationId, userId, codeHash, sourceApp, expiresAt],
  );
  return result.rows?.[0] ?? null;
}

export async function incrementLoginChallengeFailure(client, { id, maxAttempts }) {
  const result = await client.query(
    `UPDATE shared.internal_login_challenges
     SET failed_attempts = LEAST(failed_attempts + 1, 100),
         cancelled_at = CASE WHEN failed_attempts + 1 >= $2 THEN now() ELSE cancelled_at END
     WHERE id = $1
     RETURNING failed_attempts, cancelled_at`,
    [id, maxAttempts],
  );
  return result.rows?.[0] ?? null;
}

export async function consumeLoginChallenge(client, { id }) {
  const result = await client.query(
    `UPDATE shared.internal_login_challenges
     SET consumed_at = now()
     WHERE id = $1 AND consumed_at IS NULL AND cancelled_at IS NULL
     RETURNING id, consumed_at`,
    [id],
  );
  return result.rows?.[0] ?? null;
}

export async function cancelLoginChallenge(client, { id }) {
  await client.query(
    `UPDATE shared.internal_login_challenges
     SET cancelled_at = COALESCE(cancelled_at, now())
     WHERE id = $1 AND consumed_at IS NULL`,
    [id],
  );
}
