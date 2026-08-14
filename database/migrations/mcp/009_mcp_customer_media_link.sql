-- B1: persist durable MCP outlet -> canonical Core customer linkage and bridge
-- ready MCP outlet media into shared.customer_media without copying R2 objects.

ALTER TABLE mcp.mcp_route_customers
  ADD COLUMN IF NOT EXISTS core_customer_id text NULL,
  ADD COLUMN IF NOT EXISTS core_customer_address_id text NULL,
  ADD COLUMN IF NOT EXISTS core_customer_code text NULL,
  ADD COLUMN IF NOT EXISTS core_onboarding_request_id text NULL,
  ADD COLUMN IF NOT EXISTS core_onboarding_status text NULL,
  ADD COLUMN IF NOT EXISTS last_core_sync_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS mcp_route_customers_core_customer_idx
  ON mcp.mcp_route_customers (installation_id, core_customer_id)
  WHERE core_customer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION mcp.sync_route_customer_media_to_shared(p_route_customer_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  route_row record;
  media_row record;
  active_count integer := 0;
  inserted_count integer := 0;
BEGIN
  IF pg_catalog.to_regclass('shared.customer_media') IS NULL THEN
    RETURN;
  END IF;

  SELECT installation_id, id, core_customer_id
    INTO route_row
    FROM mcp.mcp_route_customers
   WHERE id = p_route_customer_id
   LIMIT 1;

  IF route_row.id IS NULL OR route_row.core_customer_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM shared.customers AS customer
     WHERE customer.installation_id = route_row.installation_id
       AND customer.id::text = route_row.core_customer_id
  ) THEN
    RETURN;
  END IF;

  SELECT count(*)::integer
    INTO active_count
    FROM shared.customer_media
   WHERE installation_id = route_row.installation_id
     AND customer_id::text = route_row.core_customer_id
     AND status IN ('pending', 'ready');

  FOR media_row IN
    SELECT *
      FROM mcp.mcp_outlet_media
     WHERE installation_id = route_row.installation_id
       AND route_customer_id = route_row.id
       AND status = 'ready'
     ORDER BY captured_at DESC NULLS LAST, created_at DESC, id DESC
  LOOP
    EXIT WHEN active_count >= 3;
    IF EXISTS (
      SELECT 1
        FROM shared.customer_media
       WHERE installation_id = media_row.installation_id
         AND source_app = 'MCP'
         AND source_media_id = media_row.id
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO shared.customer_media (
      id, installation_id, customer_id, source_app, source_media_id,
      source_route_customer_id, source_session_id, object_key, mime_type,
      expected_byte_size, actual_byte_size, width, height, etag, status,
      captured_by, captured_at, created_at, updated_at, created_by, updated_by
    ) VALUES (
      gen_random_uuid(), media_row.installation_id, route_row.core_customer_id::uuid,
      'MCP', media_row.id, media_row.route_customer_id, media_row.session_id,
      media_row.object_key, media_row.mime_type, media_row.expected_byte_size,
      media_row.actual_byte_size, media_row.width, media_row.height, media_row.etag,
      'ready', media_row.captured_by, media_row.captured_at,
      COALESCE(media_row.created_at, now()), COALESCE(media_row.updated_at, now()),
      COALESCE(NULLIF(media_row.captured_by, ''), 'service:mcp:media-bridge'),
      COALESCE(NULLIF(media_row.captured_by, ''), 'service:mcp:media-bridge')
    )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    active_count := active_count + inserted_count;
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION mcp.sync_route_customer_core_linkage_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  canonical_code text;
BEGIN
  IF NEW.route_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.core_customer_id IS NOT NULL AND pg_catalog.to_regclass('shared.customers') IS NOT NULL THEN
    SELECT code
      INTO canonical_code
      FROM shared.customers
     WHERE installation_id = NEW.installation_id
       AND id::text = NEW.core_customer_id
     LIMIT 1;
  END IF;

  UPDATE mcp.mcp_route_customers
     SET core_onboarding_request_id = COALESCE(NEW.customer_onboarding_request_id, core_onboarding_request_id),
         core_onboarding_status = COALESCE(NEW.customer_onboarding_status, core_onboarding_status),
         core_customer_id = CASE
           WHEN NEW.core_customer_id IS NOT NULL
            AND NEW.customer_onboarding_status IN ('approved', 'linked_existing')
             THEN NEW.core_customer_id
           ELSE core_customer_id
         END,
         core_customer_address_id = CASE
           WHEN NEW.core_customer_address_id IS NOT NULL
            AND NEW.customer_onboarding_status IN ('approved', 'linked_existing')
             THEN NEW.core_customer_address_id
           ELSE core_customer_address_id
         END,
         core_customer_code = COALESCE(canonical_code, core_customer_code),
         last_core_sync_at = COALESCE(NEW.customer_onboarding_last_synced_at, now()),
         updated_at = now()
   WHERE installation_id = NEW.installation_id
     AND id = NEW.route_customer_id;

  PERFORM mcp.sync_route_customer_media_to_shared(NEW.route_customer_id);
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS mcp_orders_route_customer_core_linkage ON mcp.orders;
CREATE TRIGGER mcp_orders_route_customer_core_linkage
AFTER INSERT OR UPDATE OF
  customer_onboarding_request_id,
  customer_onboarding_status,
  core_customer_id,
  core_customer_address_id,
  customer_onboarding_last_synced_at
ON mcp.orders
FOR EACH ROW
EXECUTE FUNCTION mcp.sync_route_customer_core_linkage_from_order();

CREATE OR REPLACE FUNCTION mcp.sync_outlet_media_shared_registry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.status = 'ready' THEN
    PERFORM mcp.sync_route_customer_media_to_shared(NEW.route_customer_id);
  ELSIF NEW.status = 'deleted' AND pg_catalog.to_regclass('shared.customer_media') IS NOT NULL THEN
    UPDATE shared.customer_media
       SET status = 'deleted', updated_at = now(), updated_by = 'service:mcp:media-bridge'
     WHERE installation_id = NEW.installation_id
       AND source_app = 'MCP'
       AND source_media_id = NEW.id
       AND status <> 'deleted';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS mcp_outlet_media_shared_registry ON mcp.mcp_outlet_media;
CREATE TRIGGER mcp_outlet_media_shared_registry
AFTER INSERT OR UPDATE OF status
ON mcp.mcp_outlet_media
FOR EACH ROW
EXECUTE FUNCTION mcp.sync_outlet_media_shared_registry();

-- Backfill durable outlet linkage from the latest onboarding projection already stored
-- on MCP orders. Do not infer identity from an order at read time after this migration.
WITH latest AS (
  SELECT DISTINCT ON (installation_id, route_customer_id)
    installation_id,
    route_customer_id,
    customer_onboarding_request_id,
    customer_onboarding_status,
    core_customer_id,
    core_customer_address_id,
    customer_onboarding_last_synced_at
  FROM mcp.orders
  WHERE route_customer_id IS NOT NULL
    AND customer_onboarding_request_id IS NOT NULL
  ORDER BY installation_id, route_customer_id,
           customer_onboarding_last_synced_at DESC NULLS LAST,
           updated_at DESC,
           id DESC
)
UPDATE mcp.mcp_route_customers AS route_customer
   SET core_onboarding_request_id = latest.customer_onboarding_request_id,
       core_onboarding_status = latest.customer_onboarding_status,
       core_customer_id = CASE
         WHEN latest.core_customer_id IS NOT NULL
          AND latest.customer_onboarding_status IN ('approved', 'linked_existing')
           THEN latest.core_customer_id
         ELSE route_customer.core_customer_id
       END,
       core_customer_address_id = CASE
         WHEN latest.core_customer_address_id IS NOT NULL
          AND latest.customer_onboarding_status IN ('approved', 'linked_existing')
           THEN latest.core_customer_address_id
         ELSE route_customer.core_customer_address_id
       END,
       last_core_sync_at = COALESCE(latest.customer_onboarding_last_synced_at, route_customer.last_core_sync_at),
       updated_at = now()
  FROM latest
 WHERE route_customer.installation_id = latest.installation_id
   AND route_customer.id = latest.route_customer_id;

DO $migration$
DECLARE
  route_row record;
BEGIN
  IF pg_catalog.to_regclass('shared.customers') IS NOT NULL THEN
    UPDATE mcp.mcp_route_customers AS route_customer
       SET core_customer_code = customer.code
      FROM shared.customers AS customer
     WHERE route_customer.core_customer_id IS NOT NULL
       AND customer.installation_id = route_customer.installation_id
       AND customer.id::text = route_customer.core_customer_id;
  END IF;

  FOR route_row IN
    SELECT id
      FROM mcp.mcp_route_customers
     WHERE core_customer_id IS NOT NULL
  LOOP
    PERFORM mcp.sync_route_customer_media_to_shared(route_row.id);
  END LOOP;
END
$migration$;
