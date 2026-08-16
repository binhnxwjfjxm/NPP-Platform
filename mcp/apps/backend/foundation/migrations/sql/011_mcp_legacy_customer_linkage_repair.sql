-- Repair historical MCP -> Core customer linkage for legacy session-customer orders.
-- Migration 009 assumed mcp.orders.source_id was a route-customer id; legacy orders persisted
-- source_type='session_customer' with source_id=mcp_session_customers.id instead.
-- This forward migration keeps 009 immutable and repairs the identity resolver for both
-- historical backfill and future legacy order projection updates.

CREATE OR REPLACE FUNCTION mcp.resolve_order_route_customer_id(
  p_installation_id text,
  p_source_type text,
  p_source_id text,
  p_raw_payload jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  payload_route_customer_id text;
  session_route_customer_id text;
  direct_route_customer_id text;
BEGIN
  SELECT route_customer.id
    INTO payload_route_customer_id
    FROM mcp.mcp_route_customers AS route_customer
   WHERE route_customer.installation_id IS NOT DISTINCT FROM p_installation_id
     AND route_customer.id = NULLIF(btrim(COALESCE(p_raw_payload ->> 'routeCustomerId', '')), '')
   LIMIT 1;

  IF p_source_type = 'session_customer' THEN
    SELECT session_customer.route_customer_id
      INTO session_route_customer_id
      FROM mcp.mcp_session_customers AS session_customer
      JOIN mcp.mcp_route_customers AS route_customer
        ON route_customer.id = session_customer.route_customer_id
       AND route_customer.installation_id IS NOT DISTINCT FROM p_installation_id
     WHERE session_customer.installation_id IS NOT DISTINCT FROM p_installation_id
       AND session_customer.id = NULLIF(btrim(COALESCE(p_source_id, '')), '')
     LIMIT 1;
  END IF;

  SELECT route_customer.id
    INTO direct_route_customer_id
    FROM mcp.mcp_route_customers AS route_customer
   WHERE route_customer.installation_id IS NOT DISTINCT FROM p_installation_id
     AND route_customer.id = NULLIF(btrim(COALESCE(p_source_id, '')), '')
   LIMIT 1;

  IF payload_route_customer_id IS NOT NULL
     AND session_route_customer_id IS NOT NULL
     AND payload_route_customer_id <> session_route_customer_id THEN
    RAISE EXCEPTION 'mcp_order_route_customer_identity_conflict'
      USING ERRCODE = '23514';
  END IF;

  IF payload_route_customer_id IS NOT NULL
     AND direct_route_customer_id IS NOT NULL
     AND payload_route_customer_id <> direct_route_customer_id THEN
    RAISE EXCEPTION 'mcp_order_route_customer_identity_conflict'
      USING ERRCODE = '23514';
  END IF;

  IF session_route_customer_id IS NOT NULL
     AND direct_route_customer_id IS NOT NULL
     AND session_route_customer_id <> direct_route_customer_id THEN
    RAISE EXCEPTION 'mcp_order_route_customer_identity_conflict'
      USING ERRCODE = '23514';
  END IF;

  RETURN COALESCE(
    payload_route_customer_id,
    session_route_customer_id,
    direct_route_customer_id
  );
END
$function$;

REVOKE ALL ON FUNCTION mcp.resolve_order_route_customer_id(text, text, text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION mcp.sync_route_customer_core_linkage_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  canonical_code text;
  route_customer_id text;
  route_link record;
  is_linked boolean;
BEGIN
  IF NEW.customer_onboarding_request_id IS NULL
     AND NEW.customer_onboarding_status IS NULL THEN
    RETURN NEW;
  END IF;

  route_customer_id := mcp.resolve_order_route_customer_id(
    NEW.installation_id,
    NEW.source_type,
    NEW.source_id,
    NEW.raw_payload
  );

  IF route_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT core_customer_id, core_customer_address_id
    INTO route_link
    FROM mcp.mcp_route_customers
   WHERE installation_id IS NOT DISTINCT FROM NEW.installation_id
     AND id = route_customer_id
   FOR UPDATE;

  is_linked := NEW.customer_onboarding_status IN ('approved', 'linked_existing');

  IF is_linked
     AND route_link.core_customer_id IS NOT NULL
     AND route_link.core_customer_id <> NEW.core_customer_id THEN
    RAISE EXCEPTION 'mcp_route_customer_core_customer_conflict'
      USING ERRCODE = '23514';
  END IF;

  IF is_linked
     AND route_link.core_customer_address_id IS NOT NULL
     AND route_link.core_customer_address_id <> NEW.core_customer_address_id THEN
    RAISE EXCEPTION 'mcp_route_customer_core_address_conflict'
      USING ERRCODE = '23514';
  END IF;

  IF is_linked AND pg_catalog.to_regclass('shared.customers') IS NOT NULL THEN
    SELECT code
      INTO canonical_code
      FROM shared.customers
     WHERE installation_id = NEW.installation_id
       AND id::text = NEW.core_customer_id
     LIMIT 1;

    IF canonical_code IS NULL THEN
      RAISE EXCEPTION 'mcp_route_customer_core_customer_missing'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  UPDATE mcp.mcp_route_customers
     SET core_onboarding_request_id = CASE
           WHEN is_linked OR core_customer_id IS NULL
             THEN COALESCE(NEW.customer_onboarding_request_id, core_onboarding_request_id)
           ELSE core_onboarding_request_id
         END,
         core_onboarding_status = CASE
           WHEN is_linked OR core_customer_id IS NULL
             THEN COALESCE(NEW.customer_onboarding_status, core_onboarding_status)
           ELSE core_onboarding_status
         END,
         core_customer_id = CASE
           WHEN is_linked THEN NEW.core_customer_id
           ELSE core_customer_id
         END,
         core_customer_address_id = CASE
           WHEN is_linked THEN NEW.core_customer_address_id
           ELSE core_customer_address_id
         END,
         core_customer_code = CASE
           WHEN is_linked THEN COALESCE(canonical_code, core_customer_code)
           ELSE core_customer_code
         END,
         last_core_sync_at = CASE
           WHEN is_linked OR core_customer_id IS NULL
             THEN COALESCE(NEW.customer_onboarding_last_synced_at, last_core_sync_at, now())
           ELSE last_core_sync_at
         END,
         updated_at = now()
   WHERE installation_id IS NOT DISTINCT FROM NEW.installation_id
     AND id = route_customer_id;

  IF is_linked THEN
    PERFORM mcp.sync_route_customer_media_to_shared(route_customer_id);
  END IF;

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

DO $migration$
DECLARE
  conflict_row record;
BEGIN
  FOR conflict_row IN
    WITH resolved_linked_orders AS (
      SELECT
        order_row.installation_id,
        mcp.resolve_order_route_customer_id(
          order_row.installation_id,
          order_row.source_type,
          order_row.source_id,
          order_row.raw_payload
        ) AS route_customer_id,
        order_row.core_customer_id,
        order_row.core_customer_address_id
      FROM mcp.orders AS order_row
      WHERE order_row.customer_onboarding_request_id IS NOT NULL
        AND order_row.customer_onboarding_status IN ('approved', 'linked_existing')
        AND order_row.core_customer_id IS NOT NULL
        AND order_row.core_customer_address_id IS NOT NULL
    )
    SELECT installation_id, route_customer_id
      FROM resolved_linked_orders
     WHERE route_customer_id IS NOT NULL
     GROUP BY installation_id, route_customer_id
    HAVING count(DISTINCT core_customer_id) > 1
        OR count(DISTINCT core_customer_address_id) > 1
  LOOP
    RAISE EXCEPTION 'mcp_legacy_customer_linkage_conflict'
      USING ERRCODE = '23514';
  END LOOP;

  FOR conflict_row IN
    WITH resolved_linked_orders AS (
      SELECT
        order_row.*,
        mcp.resolve_order_route_customer_id(
          order_row.installation_id,
          order_row.source_type,
          order_row.source_id,
          order_row.raw_payload
        ) AS route_customer_id
      FROM mcp.orders AS order_row
      WHERE order_row.customer_onboarding_request_id IS NOT NULL
        AND order_row.customer_onboarding_status IN ('approved', 'linked_existing')
        AND order_row.core_customer_id IS NOT NULL
        AND order_row.core_customer_address_id IS NOT NULL
    ),
    latest AS (
      SELECT DISTINCT ON (installation_id, route_customer_id)
        installation_id,
        route_customer_id,
        core_customer_id,
        core_customer_address_id
      FROM resolved_linked_orders
      WHERE route_customer_id IS NOT NULL
      ORDER BY
        installation_id,
        route_customer_id,
        customer_onboarding_last_synced_at DESC NULLS LAST,
        updated_at DESC,
        id DESC
    )
    SELECT latest.installation_id, latest.route_customer_id
      FROM latest
      JOIN mcp.mcp_route_customers AS route_customer
        ON route_customer.installation_id IS NOT DISTINCT FROM latest.installation_id
       AND route_customer.id = latest.route_customer_id
     WHERE (
       route_customer.core_customer_id IS NOT NULL
       AND route_customer.core_customer_id <> latest.core_customer_id
     ) OR (
       route_customer.core_customer_address_id IS NOT NULL
       AND route_customer.core_customer_address_id <> latest.core_customer_address_id
     )
  LOOP
    RAISE EXCEPTION 'mcp_existing_route_customer_linkage_conflict'
      USING ERRCODE = '23514';
  END LOOP;

  IF pg_catalog.to_regclass('shared.customers') IS NOT NULL THEN
    FOR conflict_row IN
      WITH resolved_linked_orders AS (
        SELECT
          order_row.installation_id,
          mcp.resolve_order_route_customer_id(
            order_row.installation_id,
            order_row.source_type,
            order_row.source_id,
            order_row.raw_payload
          ) AS route_customer_id,
          order_row.core_customer_id
        FROM mcp.orders AS order_row
        WHERE order_row.customer_onboarding_request_id IS NOT NULL
          AND order_row.customer_onboarding_status IN ('approved', 'linked_existing')
          AND order_row.core_customer_id IS NOT NULL
          AND order_row.core_customer_address_id IS NOT NULL
      )
      SELECT resolved.installation_id, resolved.route_customer_id
        FROM resolved_linked_orders AS resolved
       WHERE resolved.route_customer_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM shared.customers AS customer
            WHERE customer.installation_id = resolved.installation_id
              AND customer.id::text = resolved.core_customer_id
         )
       LIMIT 1
    LOOP
      RAISE EXCEPTION 'mcp_legacy_core_customer_missing'
        USING ERRCODE = '23503';
    END LOOP;
  END IF;
END
$migration$;

WITH resolved_linked_orders AS (
  SELECT
    order_row.*,
    mcp.resolve_order_route_customer_id(
      order_row.installation_id,
      order_row.source_type,
      order_row.source_id,
      order_row.raw_payload
    ) AS route_customer_id
  FROM mcp.orders AS order_row
  WHERE order_row.customer_onboarding_request_id IS NOT NULL
    AND order_row.customer_onboarding_status IN ('approved', 'linked_existing')
    AND order_row.core_customer_id IS NOT NULL
    AND order_row.core_customer_address_id IS NOT NULL
),
latest AS (
  SELECT DISTINCT ON (installation_id, route_customer_id)
    installation_id,
    route_customer_id,
    customer_onboarding_request_id,
    customer_onboarding_status,
    core_customer_id,
    core_customer_address_id,
    customer_onboarding_last_synced_at
  FROM resolved_linked_orders
  WHERE route_customer_id IS NOT NULL
  ORDER BY
    installation_id,
    route_customer_id,
    customer_onboarding_last_synced_at DESC NULLS LAST,
    updated_at DESC,
    id DESC
)
UPDATE mcp.mcp_route_customers AS route_customer
   SET core_onboarding_request_id = latest.customer_onboarding_request_id,
       core_onboarding_status = latest.customer_onboarding_status,
       core_customer_id = latest.core_customer_id,
       core_customer_address_id = latest.core_customer_address_id,
       last_core_sync_at = COALESCE(latest.customer_onboarding_last_synced_at, route_customer.last_core_sync_at),
       updated_at = now()
  FROM latest
 WHERE route_customer.installation_id IS NOT DISTINCT FROM latest.installation_id
   AND route_customer.id = latest.route_customer_id
   AND (
     route_customer.core_onboarding_request_id IS DISTINCT FROM latest.customer_onboarding_request_id
     OR route_customer.core_onboarding_status IS DISTINCT FROM latest.customer_onboarding_status
     OR route_customer.core_customer_id IS DISTINCT FROM latest.core_customer_id
     OR route_customer.core_customer_address_id IS DISTINCT FROM latest.core_customer_address_id
     OR route_customer.last_core_sync_at IS DISTINCT FROM COALESCE(latest.customer_onboarding_last_synced_at, route_customer.last_core_sync_at)
   );

DO $migration$
BEGIN
  IF pg_catalog.to_regclass('shared.customers') IS NOT NULL THEN
    UPDATE mcp.mcp_route_customers AS route_customer
       SET core_customer_code = customer.code,
           updated_at = now()
      FROM shared.customers AS customer
     WHERE route_customer.core_customer_id IS NOT NULL
       AND customer.installation_id = route_customer.installation_id
       AND customer.id::text = route_customer.core_customer_id
       AND route_customer.core_customer_code IS DISTINCT FROM customer.code;
  END IF;
END
$migration$;

DO $migration$
BEGIN
  IF EXISTS (
    WITH resolved_linked_orders AS (
      SELECT
        order_row.*,
        mcp.resolve_order_route_customer_id(
          order_row.installation_id,
          order_row.source_type,
          order_row.source_id,
          order_row.raw_payload
        ) AS route_customer_id
      FROM mcp.orders AS order_row
      WHERE order_row.customer_onboarding_request_id IS NOT NULL
        AND order_row.customer_onboarding_status IN ('approved', 'linked_existing')
        AND order_row.core_customer_id IS NOT NULL
        AND order_row.core_customer_address_id IS NOT NULL
    ),
    latest AS (
      SELECT DISTINCT ON (installation_id, route_customer_id)
        installation_id,
        route_customer_id,
        customer_onboarding_request_id,
        customer_onboarding_status,
        core_customer_id,
        core_customer_address_id
      FROM resolved_linked_orders
      WHERE route_customer_id IS NOT NULL
      ORDER BY
        installation_id,
        route_customer_id,
        customer_onboarding_last_synced_at DESC NULLS LAST,
        updated_at DESC,
        id DESC
    )
    SELECT 1
      FROM latest
      JOIN mcp.mcp_route_customers AS route_customer
        ON route_customer.installation_id IS NOT DISTINCT FROM latest.installation_id
       AND route_customer.id = latest.route_customer_id
     WHERE route_customer.core_onboarding_request_id IS DISTINCT FROM latest.customer_onboarding_request_id
        OR route_customer.core_onboarding_status IS DISTINCT FROM latest.customer_onboarding_status
        OR route_customer.core_customer_id IS DISTINCT FROM latest.core_customer_id
        OR route_customer.core_customer_address_id IS DISTINCT FROM latest.core_customer_address_id
  ) THEN
    RAISE EXCEPTION 'mcp_legacy_customer_linkage_repair_failed'
      USING ERRCODE = '23514';
  END IF;
END
$migration$;

DO $migration$
DECLARE
  route_row record;
BEGIN
  FOR route_row IN
    SELECT id
      FROM mcp.mcp_route_customers
     WHERE core_customer_id IS NOT NULL
  LOOP
    PERFORM mcp.sync_route_customer_media_to_shared(route_row.id);
  END LOOP;
END
$migration$;
