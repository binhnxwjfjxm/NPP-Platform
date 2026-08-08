export async function getActiveMembershipByIdentity(client, {
  installationId,
  provider = 'CLERK',
  providerSubject,
}) {
  const result = await client.query(
    `SELECT
       pu.id AS portal_user_id,
       pu.display_name AS portal_display_name,
       pi.provider,
       pi.provider_subject,
       membership.id AS membership_id,
       membership.customer_id,
       customer.code AS customer_code,
       customer.name AS customer_name,
       membership.default_warehouse_id,
       warehouse.code AS warehouse_code,
       warehouse.name AS warehouse_name,
       membership.sales_channel_id,
       channel.code AS sales_channel_code,
       channel.name AS sales_channel_name,
       membership.collection_policy,
       membership.allow_cancel
     FROM shared.portal_identities pi
     JOIN shared.portal_users pu
       ON pu.installation_id = pi.installation_id
      AND pu.id = pi.portal_user_id
      AND pu.status = 'ACTIVE'
     JOIN sales.customer_portal_memberships membership
       ON membership.installation_id = pu.installation_id
      AND membership.portal_user_id = pu.id
      AND membership.status = 'ACTIVE'
     JOIN shared.customers customer
       ON customer.installation_id = membership.installation_id
      AND customer.id = membership.customer_id
      AND customer.is_active = true
     JOIN shared.warehouses warehouse
       ON warehouse.installation_id = membership.installation_id
      AND warehouse.id = membership.default_warehouse_id
      AND warehouse.is_active = true
     JOIN shared.sales_channels channel
       ON channel.installation_id = membership.installation_id
      AND channel.id = membership.sales_channel_id
      AND channel.is_active = true
     WHERE pi.installation_id = $1
       AND pi.provider = $2
       AND pi.provider_subject = $3
     ORDER BY membership.created_at ASC
     LIMIT 2`,
    [installationId, provider, providerSubject],
  );
  if (result.rows.length !== 1) return null;
  return result.rows[0];
}

export async function listActiveCustomerAddresses(client, { installationId, customerId }) {
  return (await client.query(
    `SELECT id, label, recipient_name, phone, address_line1, address_line2,
            ward, district, province, postal_code, country_code, is_default
     FROM shared.customer_addresses
     WHERE installation_id = $1 AND customer_id = $2 AND is_active = true
     ORDER BY is_default DESC, label ASC, created_at ASC`,
    [installationId, customerId],
  )).rows;
}

export async function getActiveCustomerAddress(client, { installationId, customerId, addressId }) {
  return (await client.query(
    `SELECT id, customer_id, label, recipient_name, phone, address_line1, address_line2,
            ward, district, province, postal_code, country_code, is_default
     FROM shared.customer_addresses
     WHERE installation_id = $1 AND customer_id = $2 AND id = $3 AND is_active = true`,
    [installationId, customerId, addressId],
  )).rows[0] ?? null;
}
