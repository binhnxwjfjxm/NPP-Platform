import { randomUUID } from 'node:crypto';

const COLUMNS = `id, installation_id, document_type, template_code, page_size,
  visible_field_keys, heading, title, subtitle, created_at, updated_at, created_by, updated_by`;

export async function listDocumentPrintTemplateSettings(client, { installationId }) {
  const result = await client.query(
    `SELECT ${COLUMNS}
       FROM shared.document_print_template_settings
      WHERE installation_id = $1
      ORDER BY document_type, template_code`,
    [installationId],
  );
  return result.rows;
}

export async function getDocumentPrintTemplateSetting(client, {
  installationId,
  documentType,
  templateCode,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT ${COLUMNS}
       FROM shared.document_print_template_settings
      WHERE installation_id = $1 AND document_type = $2 AND template_code = $3${forUpdate ? ' FOR UPDATE' : ''}`,
    [installationId, documentType, templateCode],
  );
  return result.rows[0] ?? null;
}

export async function insertDocumentPrintTemplateSetting(client, data) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO shared.document_print_template_settings (
      id, installation_id, document_type, template_code, page_size,
      visible_field_keys, heading, title, subtitle, created_by, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$10)
    RETURNING ${COLUMNS}`,
    [
      id,
      data.installationId,
      data.documentType,
      data.templateCode,
      data.pageSize,
      JSON.stringify(data.visibleFieldKeys),
      data.heading,
      data.title,
      data.subtitle,
      data.actorId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function updateDocumentPrintTemplateSetting(client, data) {
  const result = await client.query(
    `UPDATE shared.document_print_template_settings
        SET page_size = $1,
            visible_field_keys = $2::jsonb,
            heading = $3,
            title = $4,
            subtitle = $5,
            updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
            updated_by = $6
      WHERE installation_id = $7
        AND document_type = $8
        AND template_code = $9
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $10::timestamptz)
    RETURNING ${COLUMNS}`,
    [
      data.pageSize,
      JSON.stringify(data.visibleFieldKeys),
      data.heading,
      data.title,
      data.subtitle,
      data.actorId,
      data.installationId,
      data.documentType,
      data.templateCode,
      data.expectedUpdatedAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function deleteDocumentPrintTemplateSetting(client, {
  installationId,
  documentType,
  templateCode,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `DELETE FROM shared.document_print_template_settings
      WHERE installation_id = $1
        AND document_type = $2
        AND template_code = $3
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $4::timestamptz)
    RETURNING ${COLUMNS}`,
    [installationId, documentType, templateCode, expectedUpdatedAt],
  );
  return result.rows[0] ?? null;
}
