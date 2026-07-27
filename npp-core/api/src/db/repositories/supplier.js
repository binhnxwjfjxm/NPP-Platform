import { randomUUID } from 'node:crypto';

const SUPPLIER_COLUMNS = `s.id, s.installation_id, s.code, s.name, s.tax_id,
  s.bank_account, s.bank_name, s.avg_delivery_days, s.purchase_owner_employee_id,
  s.is_active, s.created_at, s.updated_at, s.created_by, s.updated_by,
  e.full_name AS purchase_owner_employee_name`;

const CONTACT_COLUMNS = `id, installation_id, supplier_id, contact_name, contact_title,
  phone, email, is_primary, created_at, updated_at, created_by, updated_by`;

const ADDRESS_COLUMNS = `id, installation_id, supplier_id, address_type, street,
  city, province, postal_code, country, is_primary, created_at, updated_at, created_by, updated_by`;

const PAYMENT_TERMS_COLUMNS = `id, installation_id, supplier_id, payment_method, term_days,
  description, is_primary, is_active, created_at, updated_at, created_by, updated_by`;

export async function insertSupplier(client, {
  installationId,
  code,
  name,
  taxId,
  bankAccount,
  bankName,
  avgDeliveryDays,
  purchaseOwnerEmployeeId,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.suppliers
      (id, installation_id, code, name, tax_id, bank_account, bank_name,
       avg_delivery_days, purchase_owner_employee_id, is_active,
       created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, $12, $13)
     ON CONFLICT (installation_id, code) DO NOTHING
     RETURNING id`,
    [
      id,
      installationId,
      code,
      name,
      taxId || null,
      bankAccount || null,
      bankName || null,
      avgDeliveryDays || null,
      purchaseOwnerEmployeeId || null,
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  if (!result.rows[0]) return null;
  return getSupplierByIdForInstallation(client, { id, installationId });
}

export async function getSupplierByIdForInstallation(client, { id, installationId }) {
  const result = await client.query(
    `SELECT ${SUPPLIER_COLUMNS}
     FROM shared.suppliers s
     LEFT JOIN shared.employees e
       ON e.installation_id = s.installation_id AND e.id = s.purchase_owner_employee_id
     WHERE s.id = $1 AND s.installation_id = $2`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getSupplierByIdForInstallationForUpdate(client, { id, installationId }) {
  const result = await client.query(
    `SELECT s.id, s.installation_id, s.code, s.name, s.tax_id, s.bank_account,
            s.bank_name, s.avg_delivery_days, s.purchase_owner_employee_id, s.is_active,
            s.created_at, s.updated_at, s.created_by, s.updated_by
     FROM shared.suppliers s
     WHERE s.id = $1 AND s.installation_id = $2
     FOR UPDATE`,
    [id, installationId],
  );
  return result.rows[0] || null;
}

export async function getSupplierByCode(client, { installationId, code }) {
  const result = await client.query(
    `SELECT ${SUPPLIER_COLUMNS}
     FROM shared.suppliers s
     LEFT JOIN shared.employees e
       ON e.installation_id = s.installation_id AND e.id = s.purchase_owner_employee_id
     WHERE s.installation_id = $1 AND s.code = $2`,
    [installationId, code],
  );
  return result.rows[0] || null;
}

export async function listSuppliersForInstallation(client, {
  installationId,
  search,
  active,
  limit = 100,
  offset = 0,
}) {
  let query = `SELECT ${SUPPLIER_COLUMNS}
               FROM shared.suppliers s
               LEFT JOIN shared.employees e
                 ON e.installation_id = s.installation_id AND e.id = s.purchase_owner_employee_id
               WHERE s.installation_id = $1`;
  const params = [installationId];

  if (active !== undefined) {
    query += ` AND s.is_active = $${params.length + 1}`;
    params.push(Boolean(active));
  }

  if (search) {
    query += ` AND (
      s.code ILIKE $${params.length + 1}
      OR s.name ILIKE $${params.length + 1}
      OR COALESCE(s.tax_id, '') ILIKE $${params.length + 1}
      OR COALESCE(s.bank_account, '') ILIKE $${params.length + 1}
    )`;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY s.code ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);
  const result = await client.query(query, params);
  return result.rows;
}

export async function updateSupplier(client, {
  id,
  installationId,
  name,
  taxId,
  bankAccount,
  bankName,
  avgDeliveryDays,
  purchaseOwnerEmployeeId,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.suppliers
     SET name = $1,
         tax_id = $2,
         bank_account = $3,
         bank_name = $4,
         avg_delivery_days = $5,
         purchase_owner_employee_id = $6,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond'),
         updated_by = $7
     WHERE id = $8
       AND installation_id = $9
       AND updated_at = $10
     RETURNING id`,
    [
      name,
      taxId || null,
      bankAccount || null,
      bankName || null,
      avgDeliveryDays || null,
      purchaseOwnerEmployeeId || null,
      updatedBy,
      id,
      installationId,
      expectedUpdatedAt,
    ],
  );
  if (!result.rows[0]) return null;
  return getSupplierByIdForInstallation(client, { id, installationId });
}

export async function updateSupplierActiveStatus(client, {
  id,
  installationId,
  isActive,
  updatedBy,
  expectedUpdatedAt,
}) {
  const result = await client.query(
    `UPDATE shared.suppliers
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
  return getSupplierByIdForInstallation(client, { id, installationId });
}

// Supplier Contacts
export async function insertSupplierContact(client, {
  installationId,
  supplierId,
  contactName,
  contactTitle,
  phone,
  email,
  isPrimary,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.supplier_contacts
      (id, installation_id, supplier_id, contact_name, contact_title, phone,
       email, is_primary, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING ${CONTACT_COLUMNS}`,
    [
      id,
      installationId,
      supplierId,
      contactName,
      contactTitle || null,
      phone || null,
      email || null,
      isPrimary,
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  return result.rows[0] || null;
}

export async function listSupplierContacts(client, { installationId, supplierId }) {
  const result = await client.query(
    `SELECT ${CONTACT_COLUMNS}
     FROM shared.supplier_contacts
     WHERE installation_id = $1 AND supplier_id = $2
     ORDER BY is_primary DESC, contact_name ASC`,
    [installationId, supplierId],
  );
  return result.rows;
}

// Supplier Addresses
export async function insertSupplierAddress(client, {
  installationId,
  supplierId,
  addressType,
  street,
  city,
  province,
  postalCode,
  country,
  isPrimary,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.supplier_addresses
      (id, installation_id, supplier_id, address_type, street, city,
       province, postal_code, country, is_primary, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING ${ADDRESS_COLUMNS}`,
    [
      id,
      installationId,
      supplierId,
      addressType,
      street,
      city || null,
      province || null,
      postalCode || null,
      country || null,
      isPrimary,
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  return result.rows[0] || null;
}

export async function listSupplierAddresses(client, { installationId, supplierId }) {
  const result = await client.query(
    `SELECT ${ADDRESS_COLUMNS}
     FROM shared.supplier_addresses
     WHERE installation_id = $1 AND supplier_id = $2
     ORDER BY is_primary DESC, address_type ASC`,
    [installationId, supplierId],
  );
  return result.rows;
}

// Supplier Payment Terms
export async function insertSupplierPaymentTerms(client, {
  installationId,
  supplierId,
  paymentMethod,
  termDays,
  description,
  isPrimary,
  createdBy,
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = await client.query(
    `INSERT INTO shared.supplier_payment_terms
      (id, installation_id, supplier_id, payment_method, term_days,
       description, is_primary, is_active, created_at, updated_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11)
     RETURNING ${PAYMENT_TERMS_COLUMNS}`,
    [
      id,
      installationId,
      supplierId,
      paymentMethod,
      termDays || null,
      description || null,
      isPrimary,
      now,
      now,
      createdBy,
      createdBy,
    ],
  );
  return result.rows[0] || null;
}

export async function listSupplierPaymentTerms(client, { installationId, supplierId }) {
  const result = await client.query(
    `SELECT ${PAYMENT_TERMS_COLUMNS}
     FROM shared.supplier_payment_terms
     WHERE installation_id = $1 AND supplier_id = $2 AND is_active = true
     ORDER BY is_primary DESC, payment_method ASC`,
    [installationId, supplierId],
  );
  return result.rows;
}
