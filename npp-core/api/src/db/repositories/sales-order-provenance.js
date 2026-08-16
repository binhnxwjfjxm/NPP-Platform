export async function getActiveSourceEmployee(client, { installationId, employeeId }) {
  const result = await client.query(
    `SELECT id
       FROM shared.employees
      WHERE installation_id = $1
        AND id = $2
        AND is_active = true
      LIMIT 1`,
    [installationId, employeeId],
  );
  return result.rows[0] ?? null;
}

export async function setInitialSourceEmployeeSnapshot(client, {
  installationId,
  salesOrderId,
  versionNumber,
  employeeId,
}) {
  const orderResult = await client.query(
    `UPDATE sales.sales_orders
        SET source_employee_id = $1
      WHERE installation_id = $2
        AND id = $3
        AND source_type = 'MCP'
        AND (source_employee_id IS NULL OR source_employee_id = $1)
      RETURNING id, source_employee_id`,
    [employeeId, installationId, salesOrderId],
  );
  if (orderResult.rows.length !== 1) return false;

  const versionResult = await client.query(
    `UPDATE sales.sales_order_versions
        SET source_employee_id = $1
      WHERE installation_id = $2
        AND sales_order_id = $3
        AND version_number = $4
        AND source_type = 'MCP'
        AND (source_employee_id IS NULL OR source_employee_id = $1)
      RETURNING id`,
    [employeeId, installationId, salesOrderId, versionNumber],
  );
  return versionResult.rows.length === 1;
}

export async function copySourceEmployeeSnapshotToDraft(client, {
  installationId,
  salesOrderId,
  fromVersionNumber,
  toVersionNumber,
}) {
  const result = await client.query(
    `UPDATE sales.sales_order_versions AS target
        SET source_employee_id = source.source_employee_id
       FROM sales.sales_order_versions AS source
      WHERE target.installation_id = $1
        AND target.sales_order_id = $2
        AND target.version_number = $4
        AND source.installation_id = target.installation_id
        AND source.sales_order_id = target.sales_order_id
        AND source.version_number = $3
        AND target.source_type = source.source_type
        AND target.source_id IS NOT DISTINCT FROM source.source_id
        AND target.source_outlet_id IS NOT DISTINCT FROM source.source_outlet_id
      RETURNING target.id`,
    [installationId, salesOrderId, fromVersionNumber, toVersionNumber],
  );
  return result.rows.length === 1;
}

export async function loadSourceEmployeeFacts(client, { installationId, salesOrderId }) {
  const orderResult = await client.query(
    `SELECT source_employee_id
       FROM sales.sales_orders
      WHERE installation_id = $1
        AND id = $2
      LIMIT 1`,
    [installationId, salesOrderId],
  );
  const versionResult = await client.query(
    `SELECT version_number, source_employee_id
       FROM sales.sales_order_versions
      WHERE installation_id = $1
        AND sales_order_id = $2
      ORDER BY version_number ASC`,
    [installationId, salesOrderId],
  );
  return Object.freeze({
    order: orderResult.rows[0] ?? null,
    versions: Object.freeze(versionResult.rows),
  });
}