import { randomUUID } from 'node:crypto';

const GROUP_COLUMNS = `id, installation_id, code, name, description, is_active,
  created_at, updated_at, created_by, updated_by`;

const CUSTOMER_COLUMNS = `c.id, c.installation_id, c.code, c.name, c.group_id,
  c.responsible_employee_id, c.phone, c.email, c.tax_code, c.payment_terms_days,
  c.credit_limit, c.notes, c.is_active, c.created_at, c.updated_at, c.created_by,
  c.updated_by, g.name AS group_name, e.full_name AS responsible_employee_name`;

const ADDRESS_COLUMNS = `id, installation_id, customer_id, label, recipient_name,
  phone, address_line1, address_line2, ward, district, province, postal_code,
  country_code, location_url, is_default, is_active, created_at, updated_at, created_by, updated_by`;

export async function insertCustomerGroup(client, {
  installationId,
  code,
  name,
  description,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.customer_groups
      (id, installation_id, code, name, description, is_active,
       created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9)
     ON CONFLICT (installation_id, code) DO NOTHING
     RETURNING ${GROUP_COLUMNS}`,
    [id, installationId, code, name, description || null, now, now, createdBy, createdBy],
  );
  return result.rows[0] || null;
}

export async function getCustomerGroupByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${GROUP_COLUMNS}
     FROM shared.customer_groups
     WHERE id = $1 AND installation_id = $2`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getCustomerGroupByIdForInstallationForShare(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${GROUP_COLUMNS}
     FROM shared.customer_groups
     WHERE id = $1 AND installation_id = $2
     FOR SHARE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getCustomerGroupByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${GROUP_COLUMNS}
     FROM shared.customer_groups
     WHERE id = $1 AND installation_id = $2
     FOR UPDATE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getCustomerGroupByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${GROUP_COLUMNS}
     FROM shared.customer_groups
     WHERE installation_id = $1 AND code = $2`,
    [installationId, code],
  );
  return result.rows[0] || null;
}

export async function listCustomerGroupsForInstallation(client, {
  installationId,
  search,
  active,
  limit = 100,
  offset = 0,
}) {
  let query = `SELECT ${GROUP_COLUMNS}
               FROM shared.customer_groups
               WHERE installation_id = $1`;
  const params = [installationId];

  if (active !== undefined) {
    query += ` AND is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }

  if (search) {
    query += ` AND (code ILIKE $${params.length + 1} OR name ILIKE $${params.length + 1})`;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);
  const result = await client.query(query, params);
  return result.rows;
}

export async function updateCustomerGroup(client, {
  id,
  installationId,
  name,
  description,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.customer_groups
     SET name = $1,
         description = $2,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $3
     WHERE id = $4
       AND installation_id = $5
       AND updated_at = $6
     RETURNING ${GROUP_COLUMNS}`,
    [name, description || null, updatedBy, id, installationId, expectedUpdatedAt],
  );
  return result.rows[0] || null;
}

export async function updateCustomerGroupActiveStatus(client, {
  id,
  installationId,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.customer_groups
     SET is_active = $1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $2
     WHERE id = $3
       AND installation_id = $4
       AND updated_at = $5
     RETURNING ${GROUP_COLUMNS}`,
    [isActive, updatedBy, id, installationId, expectedUpdatedAt],
  );
  return result.rows[0] || null;
}

export async function insertCustomer(client, {
  installationId,
  code,
  name,
  groupId,
  responsibleEmployeeId,
  phone,
  email,
  taxCode,
  paymentTermsDays,
  creditLimit,
  notes,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.customers
      (id, installation_id, code, name, group_id, responsible_employee_id,
       phone, email, tax_code, payment_terms_days, credit_limit, notes, is_active,
       created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13, $14, $15, $16)
     ON CONFLICT (installation_id, code) DO NOTHING
     RETURNING id`,
    [
      id,
      installationId,
      code,
      name,
      groupId || null,
      responsibleEmployeeId || null,
      phone || null,
      email || null,
      taxCode || null,
      paymentTermsDays,
      creditLimit,
      notes || null,
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  if (!result.rows[0]) return null;
  return getCustomerByIdForInstallation(client, { id, installationId });
}

export async function getCustomerByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${CUSTOMER_COLUMNS}
     FROM shared.customers c
     LEFT JOIN shared.customer_groups g
       ON g.installation_id = c.installation_id AND g.id = c.group_id
     LEFT JOIN shared.employees e
       ON e.installation_id = c.installation_id AND e.id = c.responsible_employee_id
     WHERE c.id = $1 AND c.installation_id = $2`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getCustomerByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT c.id, c.installation_id, c.code, c.name, c.group_id,
            c.responsible_employee_id, c.phone, c.email, c.tax_code,
            c.payment_terms_days, c.credit_limit, c.notes, c.is_active,
            c.created_at, c.updated_at, c.created_by, c.updated_by
     FROM shared.customers c
     WHERE c.id = $1 AND c.installation_id = $2
     FOR UPDATE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getCustomerByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${CUSTOMER_COLUMNS}
     FROM shared.customers c
     LEFT JOIN shared.customer_groups g
       ON g.installation_id = c.installation_id AND g.id = c.group_id
     LEFT JOIN shared.employees e
       ON e.installation_id = c.installation_id AND e.id = c.responsible_employee_id
     WHERE c.installation_id = $1 AND c.code = $2`,
    [installationId, code],
  );
  return result.rows[0] || null;
}

export async function listCustomersForInstallation(client, {
  installationId,
  search,
  active,
  groupId,
  limit = 100,
  offset = 0,
}) {
  let query = `SELECT ${CUSTOMER_COLUMNS}
               FROM shared.customers c
               LEFT JOIN shared.customer_groups g
                 ON g.installation_id = c.installation_id AND g.id = c.group_id
               LEFT JOIN shared.employees e
                 ON e.installation_id = c.installation_id AND e.id = c.responsible_employee_id
               WHERE c.installation_id = $1`;
  const params = [installationId];

  if (active !== undefined) {
    query += ` AND c.is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }

  if (groupId) {
    query += ` AND c.group_id = $${params.length + 1}`;
    params.push(groupId);
  }

  if (search) {
    query += ` AND (
      c.code ILIKE $${params.length + 1}
      OR c.name ILIKE $${params.length + 1}
      OR COALESCE(c.phone, '') ILIKE $${params.length + 1}
      OR COALESCE(c.tax_code, '') ILIKE $${params.length + 1}
    )`;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY c.code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);
  const result = await client.query(query, params);
  return result.rows;
}

export async function updateCustomer(client, {
  id,
  installationId,
  name,
  groupId,
  responsibleEmployeeId,
  phone,
  email,
  taxCode,
  paymentTermsDays,
  creditLimit,
  notes,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.customers
     SET name = $1,
         group_id = $2,
         responsible_employee_id = $3,
         phone = $4,
         email = $5,
         tax_code = $6,
         payment_terms_days = $7,
         credit_limit = $8,
         notes = $9,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $10
     WHERE id = $11
       AND installation_id = $12
       AND updated_at = $13
     RETURNING id`,
    [
      name,
      groupId || null,
      responsibleEmployeeId || null,
      phone || null,
      email || null,
      taxCode || null,
      paymentTermsDays,
      creditLimit,
      notes || null,
      updatedBy,
      id,
      installationId,
      expectedUpdatedAt,
    ],
  );
  if (!result.rows[0]) return null;
  return getCustomerByIdForInstallation(client, { id, installationId });
}

export async function updateCustomerActiveStatus(client, {
  id,
  installationId,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.customers
     SET is_active = $1,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $2
     WHERE id = $3
       AND installation_id = $4
       AND updated_at = $5
     RETURNING id`,
    [isActive, updatedBy, id, installationId, expectedUpdatedAt],
  );
  if (!result.rows[0]) return null;
  return getCustomerByIdForInstallation(client, { id, installationId });
}

export async function listCustomerAddresses(client, { installationId, customerId }) {
  const result = await client.query(
    `SELECT ${ADDRESS_COLUMNS}
     FROM shared.customer_addresses
     WHERE installation_id = $1 AND customer_id = $2
     ORDER BY is_default DESC, is_active DESC, label ASC, created_at ASC`,
    [installationId, customerId],
  );
  return result.rows;
}

export async function getCustomerAddressForUpdate(client, {
  id,
  customerId,
  installationId,
}) {
  const result = await client.query(
    `SELECT ${ADDRESS_COLUMNS}
     FROM shared.customer_addresses
     WHERE id = $1 AND customer_id = $2 AND installation_id = $3
     FOR UPDATE`,
    [id, customerId, installationId],
  );
  return result.rows[0] || null;
}

export async function clearDefaultCustomerAddresses(client, {
  installationId,
  customerId,
  exceptId,
  updatedBy,
}) {
  const params = [updatedBy, installationId, customerId];
  let query = `UPDATE shared.customer_addresses
               SET is_default = false,
                   updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
                   updated_by = $1
               WHERE installation_id = $2
                 AND customer_id = $3
                 AND is_default = true
                 AND is_active = true`;
  if (exceptId) {
    query += ` AND id <> $4`;
    params.push(exceptId);
  }
  await client.query(query, params);
}

export async function insertCustomerAddress(client, {
  installationId,
  customerId,
  label,
  recipientName,
  phone,
  addressLine1,
  addressLine2,
  ward,
  district,
  province,
  postalCode,
  countryCode,
  locationUrl,
  isDefault,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.customer_addresses
      (id, installation_id, customer_id, label, recipient_name, phone,
       address_line1, address_line2, ward, district, province, postal_code,
       country_code, location_url, is_default, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, $16, $17, $18, $19)
     RETURNING ${ADDRESS_COLUMNS}`,
    [
      id,
      installationId,
      customerId,
      label,
      recipientName || null,
      phone || null,
      addressLine1,
      addressLine2 || null,
      ward || null,
      district || null,
      province || null,
      postalCode || null,
      countryCode,
      locationUrl || null,
      isDefault,
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  return result.rows[0] || null;
}

export async function updateCustomerAddress(client, {
  id,
  customerId,
  installationId,
  label,
  recipientName,
  phone,
  addressLine1,
  addressLine2,
  ward,
  district,
  province,
  postalCode,
  countryCode,
  locationUrl,
  isDefault,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.customer_addresses
     SET label = $1,
         recipient_name = $2,
         phone = $3,
         address_line1 = $4,
         address_line2 = $5,
         ward = $6,
         district = $7,
         province = $8,
         postal_code = $9,
         country_code = $10,
         location_url = $11,
         is_default = $12,
         is_active = $13,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $14
     WHERE id = $15
       AND customer_id = $16
       AND installation_id = $17
       AND updated_at = $18
     RETURNING ${ADDRESS_COLUMNS}`,
    [
      label,
      recipientName || null,
      phone || null,
      addressLine1,
      addressLine2 || null,
      ward || null,
      district || null,
      province || null,
      postalCode || null,
      countryCode,
      locationUrl || null,
      isDefault,
      isActive,
      updatedBy,
      id,
      customerId,
      installationId,
      expectedUpdatedAt,
    ],
  );
  return result.rows[0] || null;
}
