export async function getUserPreference(client, { installationId, userId, preferenceKey }) {
  const result = await client.query(
    `SELECT preference_value
       FROM shared.user_preferences
      WHERE installation_id = $1
        AND user_id = $2
        AND preference_key = $3`,
    [installationId, userId, preferenceKey],
  );
  return result.rows[0]?.preference_value ?? null;
}

export async function upsertUserPreference(client, {
  installationId,
  userId,
  preferenceKey,
  preferenceValue,
  actorId,
}) {
  const result = await client.query(
    `INSERT INTO shared.user_preferences (
       installation_id, user_id, preference_key, preference_value,
       created_by, updated_by
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$5)
     ON CONFLICT (installation_id, user_id, preference_key)
     DO UPDATE SET preference_value = EXCLUDED.preference_value,
                   updated_at = now(),
                   updated_by = EXCLUDED.updated_by
     RETURNING preference_value`,
    [installationId, userId, preferenceKey, JSON.stringify(preferenceValue), actorId],
  );
  return result.rows[0]?.preference_value ?? null;
}

export async function deleteUserPreference(client, { installationId, userId, preferenceKey }) {
  const result = await client.query(
    `DELETE FROM shared.user_preferences
      WHERE installation_id = $1
        AND user_id = $2
        AND preference_key = $3
      RETURNING preference_value`,
    [installationId, userId, preferenceKey],
  );
  return result.rows[0]?.preference_value ?? null;
}
