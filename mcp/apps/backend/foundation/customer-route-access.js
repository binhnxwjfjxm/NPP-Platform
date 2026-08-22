const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MCP_INSTALLATION_OWNER_ROLE = "mcp.installation-owner";

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function accessError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function requireWorkforceEmployee(context) {
  const employeeId = text(context?.principal?.employeeId)?.toLowerCase();
  if (!employeeId || !UUID_PATTERN.test(employeeId)) throw accessError("trusted_employee_required", 401);
  return employeeId;
}

export function customerAccessInstallationId(context) {
  const value = text(context?.installation?.id);
  if (!value) throw accessError("installation_id_required");
  return value;
}

export function isInstallationOwner(context) {
  return Array.isArray(context?.principal?.roles)
    && context.principal.roles.some((role) => String(role || "").trim().toLowerCase() === MCP_INSTALLATION_OWNER_ROLE);
}

const EMPLOYEE_MATCH = `
  (
    lower(btrim(employee.full_name)) = lower(btrim(COALESCE(route.sales, '')))
    OR upper(btrim(employee.code)) = upper(btrim(COALESCE(route.sales, '')))
    OR lower(employee.id::text) = lower(btrim(COALESCE(route.sales, '')))
  )
`;

const UNIQUE_ROUTE_EMPLOYEE_MATCH = `
  (
    SELECT count(*)
    FROM shared.employees AS other_employee
    WHERE other_employee.installation_id = rc.installation_id
      AND other_employee.is_active = true
      AND (
        lower(btrim(other_employee.full_name)) = lower(btrim(COALESCE(route.sales, '')))
        OR upper(btrim(other_employee.code)) = upper(btrim(COALESCE(route.sales, '')))
        OR lower(other_employee.id::text) = lower(btrim(COALESCE(route.sales, '')))
      )
  ) = 1
`;

const EMPLOYEE_ACCESS = `
  EXISTS (
    SELECT 1
    FROM shared.employees AS employee
    WHERE employee.installation_id = rc.installation_id
      AND employee.id = $2::uuid
      AND employee.is_active = true
      AND ${EMPLOYEE_MATCH}
  )
  AND ${UNIQUE_ROUTE_EMPLOYEE_MATCH}
`;

export async function loadAccessibleRouteCustomer(client, context, routeCustomerId, { forUpdate = false } = {}) {
  const employeeId = requireWorkforceEmployee(context);
  const result = await client.query(
    `SELECT
       rc.*,
       route.route_name,
       route.sales AS route_sales,
       EXISTS (
         SELECT 1
         FROM shared.employees AS employee
         WHERE employee.installation_id = rc.installation_id
           AND employee.id = $3::uuid
           AND employee.is_active = true
       ) AS employee_active,
       EXISTS (
         SELECT 1
         FROM shared.employees AS employee
         WHERE employee.installation_id = rc.installation_id
           AND employee.id = $3::uuid
           AND employee.is_active = true
           AND (
             lower(btrim(employee.full_name)) = lower(btrim(COALESCE(route.sales, '')))
             OR upper(btrim(employee.code)) = upper(btrim(COALESCE(route.sales, '')))
             OR lower(employee.id::text) = lower(btrim(COALESCE(route.sales, '')))
           )
       ) AS route_employee_match,
       (
         SELECT count(*)::integer
         FROM shared.employees AS other_employee
         WHERE other_employee.installation_id = rc.installation_id
           AND other_employee.is_active = true
           AND (
             lower(btrim(other_employee.full_name)) = lower(btrim(COALESCE(route.sales, '')))
             OR upper(btrim(other_employee.code)) = upper(btrim(COALESCE(route.sales, '')))
             OR lower(other_employee.id::text) = lower(btrim(COALESCE(route.sales, '')))
           )
       ) AS route_employee_matches
     FROM mcp.mcp_route_customers AS rc
     JOIN mcp.mcp_routes AS route
       ON route.installation_id = rc.installation_id
      AND route.id = rc.route_id
     WHERE rc.installation_id = $1
       AND rc.id = $2
       AND rc.active = true
     ${forUpdate ? "FOR UPDATE OF rc" : ""}`,
    [customerAccessInstallationId(context), routeCustomerId, employeeId]
  );
  const row = result.rows?.[0];
  if (!row) throw accessError("route_customer_not_found", 404);
  if (isInstallationOwner(context)) return row;
  if (row.employee_active !== true) throw accessError("employee_inactive", 403);
  if (!text(row.route_sales)) throw accessError("route_sales_unassigned", 409);
  if (Number(row.route_employee_matches || 0) !== 1) throw accessError("route_sales_ambiguous", 409);
  if (row.route_employee_match !== true) throw accessError("route_customer_not_owned", 403);
  return row;
}

export async function listAccessibleRouteCustomers(client, context) {
  const employeeId = requireWorkforceEmployee(context);
  const result = await client.query(
    `SELECT rc.*, route.route_name, route.sales AS route_sales
     FROM mcp.mcp_route_customers AS rc
     JOIN mcp.mcp_routes AS route
       ON route.installation_id = rc.installation_id
      AND route.id = rc.route_id
     WHERE rc.installation_id = $1
       AND rc.active = true
       AND ($3::boolean = true OR (${EMPLOYEE_ACCESS}))
     ORDER BY route.route_name, rc.sort_order, rc.customer_name, rc.id`,
    [customerAccessInstallationId(context), employeeId, isInstallationOwner(context)]
  );
  return result.rows || [];
}

export async function listAccessibleCoreCustomerLinks(client, context) {
  const employeeId = requireWorkforceEmployee(context);
  const result = await client.query(
    `SELECT
       rc.id AS route_customer_id,
       rc.core_customer_id,
       rc.core_customer_address_id
     FROM mcp.mcp_route_customers AS rc
     JOIN mcp.mcp_routes AS route
       ON route.installation_id = rc.installation_id
      AND route.id = rc.route_id
     JOIN shared.customers AS customer
       ON customer.installation_id = rc.installation_id
      AND customer.id::text = rc.core_customer_id
      AND customer.is_active = true
     JOIN shared.customer_addresses AS address
       ON address.installation_id = customer.installation_id
      AND address.customer_id = customer.id
      AND address.id::text = rc.core_customer_address_id
      AND address.is_active = true
     WHERE rc.installation_id = $1
       AND rc.active = true
       AND rc.core_onboarding_status IN ('approved', 'linked_existing')
       AND rc.core_customer_id IS NOT NULL
       AND rc.core_customer_address_id IS NOT NULL
       AND ($3::boolean = true OR (${EMPLOYEE_ACCESS}))
     ORDER BY rc.id`,
    [customerAccessInstallationId(context), employeeId, isInstallationOwner(context)]
  );
  return result.rows || [];
}

export async function listAccessibleCoreCustomers(client, context) {
  const employeeId = requireWorkforceEmployee(context);
  const result = await client.query(
    `SELECT
       customer.id,
       customer.code AS customer_code,
       customer.name,
       customer.phone,
       customer.email,
       customer.is_active,
       customer.responsible_employee_id,
       customer.updated_at,
       address.id AS default_address_id,
       address.label AS default_address_label,
       address.address_line1 AS default_address_line1
     FROM shared.customers AS customer
     LEFT JOIN LATERAL (
       SELECT candidate.id, candidate.label, candidate.address_line1
       FROM shared.customer_addresses AS candidate
       WHERE candidate.installation_id = customer.installation_id
         AND candidate.customer_id = customer.id
         AND candidate.is_active = true
       ORDER BY candidate.is_default DESC, candidate.updated_at DESC, candidate.created_at DESC, candidate.id
       LIMIT 1
     ) AS address ON true
     WHERE customer.installation_id = $1
       AND customer.is_active = true
       AND (
         $3::boolean = true
         OR (
           customer.responsible_employee_id = $2::uuid
           AND EXISTS (
             SELECT 1
             FROM shared.employees AS employee
             WHERE employee.installation_id = customer.installation_id
               AND employee.id = $2::uuid
               AND employee.is_active = true
           )
         )
       )
     ORDER BY customer.name, customer.code, customer.id`,
    [customerAccessInstallationId(context), employeeId, isInstallationOwner(context)]
  );
  return result.rows || [];
}
