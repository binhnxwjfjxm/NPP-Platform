function rows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

export async function getActiveSalesChannel(client, { installationId, id }) {
  const result = await client.query(
    `SELECT id, code, name, is_active
       FROM shared.sales_channels
      WHERE installation_id = $1 AND id = $2 AND is_active = true
      LIMIT 1`,
    [installationId, id],
  );
  return rows(result)[0] ?? null;
}

export async function listActiveSalesChannels(client, { installationId }) {
  const result = await client.query(
    `SELECT id, code, name
       FROM shared.sales_channels
      WHERE installation_id = $1 AND is_active = true
      ORDER BY code ASC, id ASC`,
    [installationId],
  );
  return rows(result);
}

export async function getDefaultSalesChannelId(client, { installationId }) {
  const result = await client.query(
    `SELECT channel.id AS default_sales_channel_id
       FROM shared.sales_order_settings AS settings
       LEFT JOIN shared.sales_channels AS channel
         ON channel.installation_id = settings.installation_id
        AND channel.id = settings.default_sales_channel_id
        AND channel.is_active = true
      WHERE settings.installation_id = $1
      LIMIT 1`,
    [installationId],
  );
  return rows(result)[0]?.default_sales_channel_id ?? null;
}

function provenance(trace) {
  const rules = trace.filter((step) => step?.kind === 'RULE');
  const last = rules.at(-1) ?? trace.find((step) => step?.kind === 'BASE') ?? null;
  return {
    priceListId: last?.priceListId ?? null,
    priceRuleId: last?.itemId ?? null,
  };
}

export async function applyCommercialSnapshot(client, {
  installationId,
  salesOrderId,
  versionNumber,
  channel,
  documentDiscount,
  lines,
}) {
  const orderResult = await client.query(
    `UPDATE sales.sales_orders
        SET sales_channel_id = $3,
            updated_at = now()
      WHERE installation_id = $1 AND id = $2`,
    [installationId, salesOrderId, channel.id],
  );
  if (orderResult.rowCount !== 1) return false;

  const manualReasons = lines
    .filter((line) => line.manualReason)
    .map((line) => `Dòng ${line.lineNumber}: ${line.manualReason}`)
    .join('; ') || null;
  const versionResult = await client.query(
    `UPDATE sales.sales_order_versions
        SET sales_channel_id = $4,
            sales_channel_code_snapshot = $5,
            sales_channel_name_snapshot = $6,
            document_discount_mode = $7,
            document_discount_value = $8,
            document_discount_reason = $9,
            price_override_reason = $10,
            updated_at = now()
      WHERE installation_id = $1
        AND sales_order_id = $2
        AND version_number = $3
        AND version_status = 'draft'
      RETURNING id`,
    [
      installationId,
      salesOrderId,
      versionNumber,
      channel.id,
      channel.code,
      channel.name,
      documentDiscount.mode,
      documentDiscount.value,
      documentDiscount.reason,
      manualReasons,
    ],
  );
  const versionId = rows(versionResult)[0]?.id;
  if (!versionId) return false;

  for (const line of lines) {
    const source = line.manualReason ? 'MANUAL_OVERRIDE' : 'PRICE_ENGINE';
    const trace = [
      {
        kind: 'RESOLUTION',
        resolutionFingerprint: line.fingerprint,
        channelId: channel.id,
      },
      ...line.systemTrace,
      ...(line.manualReason
        ? [{
            kind: 'MANUAL_OVERRIDE',
            reason: line.manualReason,
            beforeUnitPriceMinor: line.systemUnitPriceMinor,
            afterUnitPriceMinor: line.finalUnitPriceMinor,
          }]
        : []),
    ];
    const ids = provenance(line.systemTrace);
    const result = await client.query(
      `UPDATE sales.sales_order_version_lines
          SET base_unit_price = $4,
              system_unit_price = $5,
              unit_price = $6,
              price_source = $7,
              price_list_id = $8,
              price_rule_id = $9,
              manual_override_reason = $10,
              pricing_trace_snapshot = $11::jsonb,
              updated_at = now()
        WHERE installation_id = $1
          AND sales_order_version_id = $2
          AND line_number = $3`,
      [
        installationId,
        versionId,
        line.lineNumber,
        line.baseUnitPriceMinor,
        line.systemUnitPriceMinor,
        line.finalUnitPriceMinor,
        source,
        ids.priceListId,
        ids.priceRuleId,
        line.manualReason,
        JSON.stringify(trace),
      ],
    );
    if (result.rowCount !== 1) return false;
  }
  return true;
}

export async function getDraftCommercialSnapshot(client, {
  installationId,
  salesOrderId,
  versionNumber,
}) {
  const versionResult = await client.query(
    `SELECT version.id,
            version.version_number,
            version.customer_mode_snapshot,
            version.customer_id,
            version.currency_code,
            version.sales_channel_id,
            version.document_discount_mode,
            version.document_discount_value,
            version.document_discount_reason
       FROM sales.sales_order_versions AS version
      WHERE version.installation_id = $1
        AND version.sales_order_id = $2
        AND version.version_number = $3
        AND version.version_status = 'draft'
      LIMIT 1`,
    [installationId, salesOrderId, versionNumber],
  );
  const version = rows(versionResult)[0];
  if (!version) return null;
  const lineResult = await client.query(
    `SELECT line.line_number,
            line.variant_id,
            line.ordered_quantity,
            trim_scale(line.base_unit_price)::text AS base_unit_price,
            trim_scale(line.system_unit_price)::text AS system_unit_price,
            line.unit_price,
            line.price_source,
            line.manual_override_reason,
            line.pricing_trace_snapshot
       FROM sales.sales_order_version_lines AS line
      WHERE line.installation_id = $1
        AND line.sales_order_version_id = $2
      ORDER BY line.line_number ASC`,
    [installationId, version.id],
  );
  return { version, lines: rows(lineResult) };
}

export async function copyCommercialSnapshotToDraft(client, {
  installationId,
  salesOrderId,
  fromVersionNumber,
  toVersionNumber,
}) {
  const header = await client.query(
    `UPDATE sales.sales_order_versions AS target
        SET sales_channel_id = source.sales_channel_id,
            sales_channel_code_snapshot = source.sales_channel_code_snapshot,
            sales_channel_name_snapshot = source.sales_channel_name_snapshot,
            document_discount_mode = source.document_discount_mode,
            document_discount_value = source.document_discount_value,
            document_discount_reason = source.document_discount_reason,
            price_override_reason = source.price_override_reason,
            updated_at = now()
       FROM sales.sales_order_versions AS source
      WHERE target.installation_id = $1
        AND target.sales_order_id = $2
        AND target.version_number = $4
        AND target.version_status = 'draft'
        AND source.installation_id = target.installation_id
        AND source.sales_order_id = target.sales_order_id
        AND source.version_number = $3`,
    [installationId, salesOrderId, fromVersionNumber, toVersionNumber],
  );
  if (header.rowCount !== 1) return false;
  const lines = await client.query(
    `UPDATE sales.sales_order_version_lines AS target
        SET base_unit_price = source.base_unit_price,
            system_unit_price = source.system_unit_price,
            price_source = source.price_source,
            price_list_id = source.price_list_id,
            price_rule_id = source.price_rule_id,
            manual_override_reason = source.manual_override_reason,
            pricing_trace_snapshot = source.pricing_trace_snapshot,
            updated_at = now()
       FROM sales.sales_order_versions AS target_version,
            sales.sales_order_versions AS source_version,
            sales.sales_order_version_lines AS source
      WHERE target.installation_id = $1
        AND target_version.installation_id = target.installation_id
        AND target_version.id = target.sales_order_version_id
        AND target_version.sales_order_id = $2
        AND target_version.version_number = $4
        AND source_version.installation_id = target.installation_id
        AND source_version.sales_order_id = $2
        AND source_version.version_number = $3
        AND source.installation_id = target.installation_id
        AND source.sales_order_version_id = source_version.id
        AND source.line_number = target.line_number`,
    [installationId, salesOrderId, fromVersionNumber, toVersionNumber],
  );
  return lines.rowCount > 0;
}

export async function loadCommercialFacts(client, { installationId, salesOrderId }) {
  const versionResult = await client.query(
    `SELECT version.sales_order_id,
            version.version_number,
            version.sales_channel_id,
            version.sales_channel_code_snapshot,
            version.sales_channel_name_snapshot,
            version.document_discount_mode,
            version.document_discount_value,
            version.document_discount_reason
       FROM sales.sales_order_versions AS version
      WHERE version.installation_id = $1 AND version.sales_order_id = $2
      ORDER BY version.version_number ASC`,
    [installationId, salesOrderId],
  );
  const lineResult = await client.query(
    `SELECT version.version_number,
            line.line_number,
            trim_scale(line.base_unit_price)::text AS base_unit_price,
            trim_scale(line.system_unit_price)::text AS system_unit_price,
            line.manual_override_reason,
            line.pricing_trace_snapshot
       FROM sales.sales_order_versions AS version
       JOIN sales.sales_order_version_lines AS line
         ON line.installation_id = version.installation_id
        AND line.sales_order_version_id = version.id
      WHERE version.installation_id = $1 AND version.sales_order_id = $2
      ORDER BY version.version_number ASC, line.line_number ASC`,
    [installationId, salesOrderId],
  );
  return { versions: rows(versionResult), lines: rows(lineResult) };
}
