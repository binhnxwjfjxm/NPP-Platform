import { randomUUID } from 'node:crypto';

const COLUMNS = `id, installation_id, document_type, template_code, page_size, font_size_percent,
  visible_field_keys, heading, title, subtitle, heading_visible, heading_align, title_align,
  created_at, updated_at, created_by, updated_by`;

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
      id, installation_id, document_type, template_code, page_size, font_size_percent,
      visible_field_keys, heading, title, subtitle, heading_visible, heading_align, title_align,
      created_by, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$14)
    RETURNING ${COLUMNS}`,
    [
      id,
      data.installationId,
      data.documentType,
      data.templateCode,
      data.pageSize,
      data.fontSizePercent,
      JSON.stringify(data.visibleFieldKeys),
      data.heading,
      data.title,
      data.subtitle,
      data.headingVisible,
      data.headingAlign,
      data.titleAlign,
      data.actorId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function updateDocumentPrintTemplateSetting(client, data) {
  const result = await client.query(
    `UPDATE shared.document_print_template_settings
        SET page_size = $1,
            font_size_percent = $2,
            visible_field_keys = $3::jsonb,
            heading = $4,
            title = $5,
            subtitle = $6,
            heading_visible = $7,
            heading_align = $8,
            title_align = $9,
            updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
            updated_by = $10
      WHERE installation_id = $11
        AND document_type = $12
        AND template_code = $13
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $14::timestamptz)
    RETURNING ${COLUMNS}`,
    [
      data.pageSize,
      data.fontSizePercent,
      JSON.stringify(data.visibleFieldKeys),
      data.heading,
      data.title,
      data.subtitle,
      data.headingVisible,
      data.headingAlign,
      data.titleAlign,
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
