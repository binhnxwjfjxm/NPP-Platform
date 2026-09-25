export async function upsertRetailWebPushSubscription(client, {
  installationId,
  userId,
  endpointHash,
  endpoint,
  p256dh,
  authSecret,
  expirationTime,
  userAgent,
  actorId,
}) {
  const result = await client.query(
    `INSERT INTO shared.retail_web_push_subscriptions (
       installation_id, endpoint_hash, user_id, endpoint, p256dh, auth_secret,
       expiration_time, user_agent, failure_count, last_success_at, disabled_at,
       created_at, created_by, updated_at, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, NULL, NULL, now(), $9, now(), $9)
     ON CONFLICT (installation_id, endpoint_hash) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         endpoint = EXCLUDED.endpoint,
         p256dh = EXCLUDED.p256dh,
         auth_secret = EXCLUDED.auth_secret,
         expiration_time = EXCLUDED.expiration_time,
         user_agent = EXCLUDED.user_agent,
         failure_count = 0,
         disabled_at = NULL,
         updated_at = now(),
         updated_by = EXCLUDED.updated_by
     RETURNING endpoint_hash, user_id, expiration_time, disabled_at, updated_at`,
    [
      installationId,
      endpointHash,
      userId,
      endpoint,
      p256dh,
      authSecret,
      expirationTime,
      userAgent,
      actorId,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function disableRetailWebPushSubscription(client, {
  installationId,
  userId,
  endpointHash,
  actorId,
}) {
  const result = await client.query(
    `UPDATE shared.retail_web_push_subscriptions
     SET disabled_at = COALESCE(disabled_at, now()),
         updated_at = now(),
         updated_by = $4
     WHERE installation_id = $1
       AND user_id = $2
       AND endpoint_hash = $3
     RETURNING endpoint_hash, disabled_at`,
    [installationId, userId, endpointHash, actorId],
  );
  return result.rows?.[0] ?? null;
}

export async function listRetailWebPushSubscriptionsForUser(client, {
  installationId,
  userId,
}) {
  const result = await client.query(
    `SELECT endpoint_hash, user_id, endpoint, p256dh, auth_secret, expiration_time
     FROM shared.retail_web_push_subscriptions
     WHERE installation_id = $1
       AND user_id = $2
       AND disabled_at IS NULL
       AND (expiration_time IS NULL OR expiration_time > now())
     ORDER BY updated_at DESC`,
    [installationId, userId],
  );
  return result.rows ?? [];
}

export async function listRetailOwnerWebPushSubscriptions(client, {
  installationId,
}) {
  const result = await client.query(
    `SELECT s.endpoint_hash, s.user_id, s.endpoint, s.p256dh, s.auth_secret, s.expiration_time
     FROM shared.retail_web_push_subscriptions s
     JOIN shared.users u
       ON u.installation_id = s.installation_id
      AND u.id = s.user_id
      AND u.is_active = true
     JOIN shared.employees e
       ON e.installation_id = u.installation_id
      AND e.id = u.employee_id
      AND e.is_active = true
     WHERE s.installation_id = $1
       AND s.disabled_at IS NULL
       AND (s.expiration_time IS NULL OR s.expiration_time > now())
       AND EXISTS (
         SELECT 1
         FROM shared.security_owner_bindings b
         WHERE b.installation_id = s.installation_id
           AND b.user_id = s.user_id
           AND b.owner_kind IN ('PERMANENT', 'TEMPORARY')
       )
     ORDER BY s.updated_at DESC`,
    [installationId],
  );
  return result.rows ?? [];
}

export async function markRetailWebPushSuccess(client, {
  installationId,
  endpointHash,
}) {
  await client.query(
    `UPDATE shared.retail_web_push_subscriptions
     SET failure_count = 0,
         last_success_at = now(),
         updated_at = now()
     WHERE installation_id = $1
       AND endpoint_hash = $2`,
    [installationId, endpointHash],
  );
}

export async function markRetailWebPushFailure(client, {
  installationId,
  endpointHash,
  terminal,
}) {
  await client.query(
    `UPDATE shared.retail_web_push_subscriptions
     SET failure_count = LEAST(failure_count + 1, 1000),
         disabled_at = CASE
           WHEN $3::boolean THEN COALESCE(disabled_at, now())
           WHEN failure_count + 1 >= 5 THEN COALESCE(disabled_at, now())
           ELSE disabled_at
         END,
         updated_at = now()
     WHERE installation_id = $1
       AND endpoint_hash = $2`,
    [installationId, endpointHash, terminal === true],
  );
}
