import { randomUUID } from 'node:crypto';

const REQUEST_COLUMNS = `
  id,
  installation_id,
  source_system,
  source_outlet_id,
  source_demand_reference,
  order_required,
  trigger_reason,
  proposed_name,
  proposed_phone,
  proposed_address_label,
  proposed_address_line1,
  proposed_address_line2,
  proposed_ward,
  proposed_district,
  proposed_province,
  proposed_postal_code,
  proposed_country_code,
  source_metadata,
  requested_by_actor_id,
  requested_by_employee_id,
  reviewed_by_actor_id,
  status,
  review_reason,
  approved_customer_id,
  approved_customer_address_id,
  idempotency_key,
  payload_hash,
  version,
  submitted_at,
  reviewed_at,
  created_at,
  updated_at`;

function mapRequest(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    installationId: row.installation_id,
    sourceSystem: row.source_system,
    sourceOutletId: row.source_outlet_id,
    sourceDemandReference: row.source_demand_reference,
    orderRequired: row.order_required,
    triggerReason: row.trigger_reason,
    proposedCustomer: Object.freeze({
      name: row.proposed_name,
      phone: row.proposed_phone,
      address: Object.freeze({
        label: row.proposed_address_label,
        addressLine1: row.proposed_address_line1,
        addressLine2: row.proposed_address_line2,
        ward: row.proposed_ward,
        district: row.proposed_district,
        province: row.proposed_province,
        postalCode: row.proposed_postal_code,
        countryCode: row.proposed_country_code,
      }),
    }),
    sourceMetadata: row.source_metadata ?? {},
    requestedByActorId: row.requested_by_actor_id,
    requestedByEmployeeId: row.requested_by_employee_id,
    reviewedByActorId: row.reviewed_by_actor_id,
    status: row.status,
    reviewReason: row.review_reason,
    approvedCustomerId: row.approved_customer_id,
    approvedCustomerAddressId: row.approved_customer_address_id,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    version: Number(row.version),
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function insertCustomerOnboardingRequest(client, input) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO sales.customer_onboarding_requests (
      id,
      installation_id,
      source_system,
      source_outlet_id,
      source_demand_reference,
      order_required,
      trigger_reason,
      proposed_name,
      proposed_phone,
      proposed_address_label,
      proposed_address_line1,
      proposed_address_line2,
      proposed_ward,
      proposed_district,
      proposed_province,
      proposed_postal_code,
      proposed_country_code,
      source_metadata,
      requested_by_actor_id,
      requested_by_employee_id,
      status,
      idempotency_key,
      payload_hash
    ) VALUES (
      $1,$2,$3,$4,$5,true,'OFFICIAL_ORDER_REQUIRED',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'submitted',$19,$20
    )
    ON CONFLICT (installation_id, source_system, source_outlet_id, source_demand_reference) DO NOTHING
    RETURNING ${REQUEST_COLUMNS}`,
    [
      id,
      input.installationId,
      input.sourceSystem,
      input.sourceOutletId,
      input.sourceDemandReference,
      input.proposedName,
      input.proposedPhone,
      input.proposedAddressLabel,
      input.proposedAddressLine1,
      input.proposedAddressLine2,
      input.proposedWard,
      input.proposedDistrict,
      input.proposedProvince,
      input.proposedPostalCode,
      input.proposedCountryCode,
      input.sourceMetadata,
      input.requestedByActorId,
      input.requestedByEmployeeId,
      input.idempotencyKey,
      input.payloadHash,
    ],
  );
  return mapRequest(result.rows[0]);
}

export async function getCustomerOnboardingRequestById(client, { installationId, id, forUpdate = false }) {
  const result = await client.query(
    `SELECT ${REQUEST_COLUMNS}
     FROM sales.customer_onboarding_requests
     WHERE installation_id = $1 AND id = $2
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [installationId, id],
  );
  return mapRequest(result.rows[0]);
}

export async function getCustomerOnboardingRequestBySourceDemand(client, {
  installationId,
  sourceSystem,
  sourceOutletId,
  sourceDemandReference,
  forUpdate = false,
}) {
  const result = await client.query(
    `SELECT ${REQUEST_COLUMNS}
     FROM sales.customer_onboarding_requests
     WHERE installation_id = $1
       AND source_system = $2
       AND source_outlet_id = $3
       AND source_demand_reference = $4
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [installationId, sourceSystem, sourceOutletId, sourceDemandReference],
  );
  return mapRequest(result.rows[0]);
}

export async function listCustomerOnboardingRequests(client, {
  installationId,
  status,
  sourceSystem,
  sourceOutletId,
  requestedByActorId,
  limit = 100,
  offset = 0,
}) {
  let sql = `SELECT ${REQUEST_COLUMNS}
             FROM sales.customer_onboarding_requests
             WHERE installation_id = $1`;
  const values = [installationId];
  const append = (fragment, value) => {
    values.push(value);
    sql += ` AND ${fragment.replace('?', `$${values.length}`)}`;
  };
  if (status) append('status = ?', status);
  if (sourceSystem) append('source_system = ?', sourceSystem);
  if (sourceOutletId) append('source_outlet_id = ?', sourceOutletId);
  if (requestedByActorId) append('requested_by_actor_id = ?', requestedByActorId);
  values.push(limit, offset);
  sql += ` ORDER BY created_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;
  const result = await client.query(sql, values);
  return result.rows.map(mapRequest);
}

export async function transitionCustomerOnboardingRequest(client, {
  installationId,
  id,
  expectedVersion,
  allowedStatuses,
  nextStatus,
  reviewedByActorId,
  reviewReason = null,
  approvedCustomerId = null,
  approvedCustomerAddressId = null,
}) {
  const result = await client.query(
    `UPDATE sales.customer_onboarding_requests
     SET status = $1,
         reviewed_by_actor_id = $2,
         review_reason = $3,
         approved_customer_id = $4,
         approved_customer_address_id = $5,
         version = version + 1,
         reviewed_at = now(),
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), updated_at + interval '1 millisecond')
     WHERE installation_id = $6
       AND id = $7
       AND version = $8
       AND status = ANY($9::text[])
     RETURNING ${REQUEST_COLUMNS}`,
    [
      nextStatus,
      reviewedByActorId,
      reviewReason,
      approvedCustomerId,
      approvedCustomerAddressId,
      installationId,
      id,
      expectedVersion,
      allowedStatuses,
    ],
  );
  return mapRequest(result.rows[0]);
}

export async function getActiveCustomerAddressForLink(client, {
  installationId,
  customerId,
  addressId,
}) {
  const result = await client.query(
    `SELECT
       c.id AS customer_id,
       c.code AS customer_code,
       c.name AS customer_name,
       c.is_active AS customer_is_active,
       a.id AS address_id,
       a.customer_id AS address_customer_id,
       a.is_active AS address_is_active
     FROM shared.customers c
     JOIN shared.customer_addresses a
       ON a.installation_id = c.installation_id
      AND a.customer_id = c.id
     WHERE c.installation_id = $1
       AND c.id = $2
       AND a.id = $3
     FOR SHARE OF c, a`,
    [installationId, customerId, addressId],
  );
  return result.rows[0] ?? null;
}
