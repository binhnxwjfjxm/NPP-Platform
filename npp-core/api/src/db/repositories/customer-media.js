const MAX_CUSTOMER_MEDIA = 3;

function resultError(code, message) {
  return { ok: false, code, message, retryable: false };
}

function mapInternal(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    installationId: row.installation_id,
    customerId: row.customer_id,
    sourceApp: row.source_app,
    sourceMediaId: row.source_media_id,
    sourceRouteCustomerId: row.source_route_customer_id,
    sourceSessionId: row.source_session_id,
    clientUploadId: row.client_upload_id,
    objectKey: row.object_key,
    mimeType: row.mime_type,
    expectedByteSize: row.expected_byte_size == null ? null : Number(row.expected_byte_size),
    actualByteSize: row.actual_byte_size == null ? null : Number(row.actual_byte_size),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    etag: row.etag,
    status: row.status,
    capturedBy: row.captured_by,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function customerMediaPublic(media, viewUrl = null) {
  return Object.freeze({
    id: media.id,
    customerId: media.customerId,
    sourceApp: media.sourceApp,
    mimeType: media.mimeType,
    actualByteSize: media.actualByteSize,
    width: media.width,
    height: media.height,
    capturedAt: media.capturedAt,
    status: media.status,
    viewUrl,
  });
}

export async function getCustomerMedia(adapter, { installationId, customerId, mediaId }) {
  const result = await adapter.query(
    `SELECT *
       FROM shared.customer_media
      WHERE installation_id = $1 AND customer_id = $2 AND id = $3
      LIMIT 1`,
    [installationId, customerId, mediaId],
  );
  return mapInternal(result.rows?.[0]);
}

export async function listReadyCustomerMedia(adapter, { installationId, customerId }) {
  const customer = await adapter.query(
    `SELECT id FROM shared.customers WHERE installation_id = $1 AND id = $2 LIMIT 1`,
    [installationId, customerId],
  );
  if (!customer.rows?.[0]) return resultError('NOT_FOUND', 'Customer not found');
  const result = await adapter.query(
    `SELECT *
       FROM shared.customer_media
      WHERE installation_id = $1
        AND customer_id = $2
        AND status = 'ready'
      ORDER BY captured_at DESC NULLS LAST, created_at DESC, id DESC
      LIMIT $3`,
    [installationId, customerId, MAX_CUSTOMER_MEDIA],
  );
  return { ok: true, media: (result.rows ?? []).map(mapInternal), maxPhotos: MAX_CUSTOMER_MEDIA };
}

export async function prepareCoreCustomerMedia(client, {
  id,
  installationId,
  customerId,
  clientUploadId,
  objectKey,
  mimeType,
  expectedByteSize,
  actorId,
}) {
  const customer = await client.query(
    `SELECT id, is_active
       FROM shared.customers
      WHERE installation_id = $1 AND id = $2
      FOR UPDATE`,
    [installationId, customerId],
  );
  if (!customer.rows?.[0]) return resultError('NOT_FOUND', 'Customer not found');
  if (customer.rows[0].is_active !== true) return resultError('CUSTOMER_INACTIVE', 'Customer is inactive');

  const existing = await client.query(
    `SELECT *
       FROM shared.customer_media
      WHERE installation_id = $1
        AND source_app = 'CORE'
        AND client_upload_id = $2
      LIMIT 1`,
    [installationId, clientUploadId],
  );
  if (existing.rows?.[0]) {
    const media = mapInternal(existing.rows[0]);
    if (
      String(media.customerId) !== String(customerId)
      || media.mimeType !== mimeType
      || media.expectedByteSize !== expectedByteSize
    ) {
      return resultError('CONFLICT', 'Customer media upload identifier already belongs to another payload');
    }
    return { ok: true, media, changed: false, replayed: true };
  }

  const count = await client.query(
    `SELECT count(*)::integer AS count
       FROM shared.customer_media
      WHERE installation_id = $1
        AND customer_id = $2
        AND status IN ('pending', 'ready')`,
    [installationId, customerId],
  );
  if (Number(count.rows?.[0]?.count || 0) >= MAX_CUSTOMER_MEDIA) {
    return resultError('CUSTOMER_MEDIA_LIMIT_REACHED', `Customer can store at most ${MAX_CUSTOMER_MEDIA} photos`);
  }

  const inserted = await client.query(
    `INSERT INTO shared.customer_media (
       id, installation_id, customer_id, source_app, client_upload_id,
       object_key, mime_type, expected_byte_size, status,
       captured_by, captured_at, created_by, updated_by
     ) VALUES ($1,$2,$3,'CORE',$4,$5,$6,$7,'pending',$8,now(),$8,$8)
     RETURNING *`,
    [id, installationId, customerId, clientUploadId, objectKey, mimeType, expectedByteSize, actorId],
  );
  return { ok: true, media: mapInternal(inserted.rows[0]), changed: true, replayed: false };
}

export async function finalizeCoreCustomerMedia(client, {
  installationId,
  customerId,
  mediaId,
  actualByteSize,
  mimeType,
  width,
  height,
  etag,
  actorId,
}) {
  const locked = await client.query(
    `SELECT *
       FROM shared.customer_media
      WHERE installation_id = $1 AND customer_id = $2 AND id = $3
      FOR UPDATE`,
    [installationId, customerId, mediaId],
  );
  if (!locked.rows?.[0]) return resultError('CUSTOMER_MEDIA_NOT_FOUND', 'Customer photo not found');
  const current = mapInternal(locked.rows[0]);
  if (current.sourceApp !== 'CORE') return resultError('CUSTOMER_MEDIA_READ_ONLY', 'MCP customer photos are managed by MCP');
  if (current.status === 'ready') return { ok: true, media: current, changed: false, replayed: true };
  if (current.status !== 'pending') return resultError('CONFLICT', 'Customer photo is not pending');
  if (current.mimeType !== mimeType) return resultError('CUSTOMER_MEDIA_CONTENT_TYPE_MISMATCH', 'Uploaded photo content type does not match');
  if (current.expectedByteSize !== actualByteSize) return resultError('CUSTOMER_MEDIA_SIZE_MISMATCH', 'Uploaded photo size does not match');

  const updated = await client.query(
    `UPDATE shared.customer_media
        SET actual_byte_size = $4,
            width = $5,
            height = $6,
            etag = $7,
            status = 'ready',
            updated_at = now(),
            updated_by = $8
      WHERE installation_id = $1 AND customer_id = $2 AND id = $3
      RETURNING *`,
    [installationId, customerId, mediaId, actualByteSize, width, height, etag, actorId],
  );
  return { ok: true, media: mapInternal(updated.rows[0]), changed: true, replayed: false };
}

export const CUSTOMER_MEDIA_LIMIT = MAX_CUSTOMER_MEDIA;
