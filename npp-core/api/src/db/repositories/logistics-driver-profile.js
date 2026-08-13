export async function listDriverProfiles(client, {
  installationId,
  active = null,
  limit = 200,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT driver.*,
            employee.is_active AS employee_is_active,
            employee.code AS employee_code,
            employee.full_name AS employee_name,
            employee.phone AS employee_phone
       FROM logistics.driver_profiles driver
       LEFT JOIN shared.employees employee
         ON employee.installation_id = driver.installation_id
        AND employee.id = driver.employee_id
      WHERE driver.installation_id = $1
        AND ($2::boolean IS NULL OR driver.is_active = $2)
        AND (
          $2::boolean IS DISTINCT FROM true
          OR (driver.employee_id IS NOT NULL AND employee.is_active = true)
        )
      ORDER BY driver.is_active DESC, COALESCE(employee.code, driver.code), driver.id
      LIMIT $3 OFFSET $4`,
    [installationId, active, limit, offset],
  );
  return result.rows;
}

export async function listAvailableDriverEmployees(client, {
  installationId,
  limit = 1000,
  offset = 0,
}) {
  const result = await client.query(
    `SELECT employee.id,
            employee.code,
            employee.full_name,
            employee.job_title,
            employee.phone,
            employee.branch_id,
            employee.is_active
       FROM shared.employees employee
      WHERE employee.installation_id = $1
        AND employee.is_active = true
        AND NOT EXISTS (
          SELECT 1
            FROM logistics.driver_profiles driver
           WHERE driver.installation_id = employee.installation_id
             AND driver.employee_id = employee.id
             AND driver.is_active = true
        )
      ORDER BY employee.code, employee.id
      LIMIT $2 OFFSET $3`,
    [installationId, limit, offset],
  );
  return result.rows;
}

export async function findActiveDriverByEmployee(client, { installationId, employeeId, excludeDriverId = null }) {
  const result = await client.query(
    `SELECT id
       FROM logistics.driver_profiles
      WHERE installation_id = $1
        AND employee_id = $2
        AND is_active = true
        AND ($3::uuid IS NULL OR id <> $3)
      LIMIT 1`,
    [installationId, employeeId, excludeDriverId],
  );
  return result.rows[0] ?? null;
}

export async function getDriverWithEmployee(client, { installationId, driverId }) {
  const result = await client.query(
    `SELECT driver.*,
            employee.is_active AS employee_is_active,
            employee.code AS employee_code,
            employee.full_name AS employee_name,
            employee.phone AS employee_phone
       FROM logistics.driver_profiles driver
       LEFT JOIN shared.employees employee
         ON employee.installation_id = driver.installation_id
        AND employee.id = driver.employee_id
      WHERE driver.installation_id = $1
        AND driver.id = $2`,
    [installationId, driverId],
  );
  return result.rows[0] ?? null;
}
