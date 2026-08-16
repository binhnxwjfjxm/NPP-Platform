import { randomUUID } from 'node:crypto';

function rows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function getSalesChannelByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT id, code, name, is_active
       FROM shared.sales_channels
      WHERE installation_id = $1 AND code = $2
      LIMIT 1`,
    [installationId, code],
  );
  return rows(result)[0] ?? null;
}

export async function ensureSystemSalesChannel(client, {
  installationId,
  code,
  name,
  description,
  actorId,
}) {
  const existing = await getSalesChannelByCode(client, { installationId, code });
  if (existing) return existing;

  const created = await client.query(
    `INSERT INTO shared.sales_channels (
       id,
       installation_id,
       code,
       name,
       description,
       is_active,
       created_by,
       updated_by
     ) VALUES ($1, $2, $3, $4, $5, true, $6, $6)
     ON CONFLICT (installation_id, code) DO NOTHING
     RETURNING id, code, name, is_active`,
    [randomUUID(), installationId, code, name, description, actorId],
  );
  const inserted = rows(created)[0];
  if (inserted) return inserted;

  return getSalesChannelByCode(client, { installationId, code });
}
