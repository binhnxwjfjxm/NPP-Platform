export async function getCustomerOrderingHomeContent(client, { installationId, forUpdate = false } = {}) {
  const result = await client.query(
    `SELECT installation_id, section_title, is_visible, banner_image_present,
            banner_image_version, created_at, updated_at, created_by, updated_by
       FROM shared.customer_ordering_home_content
      WHERE installation_id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [installationId],
  );
  return result.rows[0] ?? null;
}

export async function saveCustomerOrderingHomeContent(client, {
  installationId,
  sectionTitle,
  isVisible,
  actorId,
}) {
  const result = await client.query(
    `INSERT INTO shared.customer_ordering_home_content (
       installation_id, section_title, is_visible, banner_image_present,
       banner_image_version, created_at, updated_at, created_by, updated_by
     ) VALUES ($1, $2, $3, false, 0, now(), now(), $4, $4)
     ON CONFLICT (installation_id) DO UPDATE
       SET section_title = EXCLUDED.section_title,
           is_visible = EXCLUDED.is_visible,
           updated_at = GREATEST(
             date_trunc('milliseconds', clock_timestamp()),
             shared.customer_ordering_home_content.updated_at + interval '1 millisecond'
           ),
           updated_by = EXCLUDED.updated_by
     RETURNING installation_id, section_title, is_visible, banner_image_present,
               banner_image_version, created_at, updated_at, created_by, updated_by`,
    [installationId, sectionTitle, Boolean(isVisible), actorId],
  );
  return result.rows[0];
}

export async function markCustomerOrderingHomeBannerUploaded(client, {
  installationId,
  actorId,
}) {
  const result = await client.query(
    `INSERT INTO shared.customer_ordering_home_content (
       installation_id, section_title, is_visible, banner_image_present,
       banner_image_version, created_at, updated_at, created_by, updated_by
     ) VALUES ($1, 'Sự kiện', false, true, 1, now(), now(), $2, $2)
     ON CONFLICT (installation_id) DO UPDATE
       SET banner_image_present = true,
           banner_image_version = shared.customer_ordering_home_content.banner_image_version + 1,
           updated_at = GREATEST(
             date_trunc('milliseconds', clock_timestamp()),
             shared.customer_ordering_home_content.updated_at + interval '1 millisecond'
           ),
           updated_by = EXCLUDED.updated_by
     RETURNING installation_id, section_title, is_visible, banner_image_present,
               banner_image_version, created_at, updated_at, created_by, updated_by`,
    [installationId, actorId],
  );
  return result.rows[0];
}
