-- Expire abandoned MCP outlet-media upload reservations after the signed PUT window.
-- R2 PUT URLs expire after five minutes. Keep a ten-minute safety window so an abandoned
-- pending row cannot consume one of the three customer-photo slots indefinitely.

CREATE OR REPLACE FUNCTION mcp.enforce_outlet_media_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, mcp
AS $function$
DECLARE
  v_active_media_count integer;
BEGIN
  IF NEW.status NOT IN ('pending', 'ready', 'deleting', 'delete_failed') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.installation_id || ':' || NEW.route_customer_id, 0)
  );

  SELECT count(*)
    INTO v_active_media_count
  FROM mcp.mcp_outlet_media media
  WHERE media.installation_id = NEW.installation_id
    AND media.route_customer_id = NEW.route_customer_id
    AND (
      media.status IN ('ready', 'deleting', 'delete_failed')
      OR (
        media.status = 'pending'
        AND media.updated_at >= now() - interval '10 minutes'
      )
    )
    AND media.id IS DISTINCT FROM NEW.id;

  IF v_active_media_count >= 3 THEN
    RAISE EXCEPTION 'outlet_media_limit_reached' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION mcp.enforce_outlet_media_limit() FROM PUBLIC;

CREATE OR REPLACE FUNCTION mcp.sync_outlet_media_shared_registry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_core_customer_id text;
  v_customer_id uuid;
  v_customer_active boolean;
  v_active_count integer := 0;
  v_changed integer := 0;
  v_actor text;
BEGIN
  v_actor := COALESCE(NULLIF(NEW.captured_by, ''), 'service:mcp:media-bridge');

  SELECT route_customer.core_customer_id
    INTO v_core_customer_id
    FROM mcp.mcp_route_customers AS route_customer
   WHERE route_customer.installation_id = NEW.installation_id
     AND route_customer.id = NEW.route_customer_id
   LIMIT 1;

  IF NEW.status = 'pending' AND v_core_customer_id IS NOT NULL THEN
    SELECT customer.id, customer.is_active
      INTO v_customer_id, v_customer_active
      FROM shared.customers AS customer
     WHERE customer.installation_id = NEW.installation_id
       AND customer.id::text = v_core_customer_id
     FOR UPDATE;

    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'linked_customer_not_found' USING ERRCODE = '23514';
    END IF;
    IF v_customer_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'linked_customer_inactive' USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::integer
      INTO v_active_count
      FROM shared.customer_media AS media
     WHERE media.installation_id = NEW.installation_id
       AND media.customer_id = v_customer_id
       AND (
         media.status = 'ready'
         OR (
           media.status = 'pending'
           AND media.updated_at >= now() - interval '10 minutes'
         )
       )
       AND NOT (media.source_app = 'MCP' AND media.source_media_id = NEW.id);

    IF v_active_count >= 3 THEN
      RAISE EXCEPTION 'outlet_media_limit_reached' USING ERRCODE = '23514';
    END IF;

    INSERT INTO shared.customer_media (
      id, installation_id, customer_id, source_app, source_media_id,
      source_route_customer_id, source_session_id, client_upload_id,
      object_key, mime_type, expected_byte_size, status,
      captured_by, captured_at, created_at, updated_at, created_by, updated_by
    ) VALUES (
      gen_random_uuid(), NEW.installation_id, v_customer_id, 'MCP', NEW.id,
      NEW.route_customer_id, NEW.session_id, NEW.client_upload_id,
      NEW.object_key, NEW.mime_type, NEW.expected_byte_size, 'pending',
      v_actor, COALESCE(NEW.captured_at, now()),
      COALESCE(NEW.created_at, now()), COALESCE(NEW.updated_at, now()),
      v_actor, v_actor
    )
    ON CONFLICT (installation_id, source_app, source_media_id)
      WHERE source_media_id IS NOT NULL
    DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      source_route_customer_id = EXCLUDED.source_route_customer_id,
      source_session_id = EXCLUDED.source_session_id,
      client_upload_id = EXCLUDED.client_upload_id,
      object_key = EXCLUDED.object_key,
      mime_type = EXCLUDED.mime_type,
      expected_byte_size = EXCLUDED.expected_byte_size,
      actual_byte_size = NULL,
      width = NULL,
      height = NULL,
      etag = NULL,
      status = 'pending',
      captured_by = EXCLUDED.captured_by,
      captured_at = EXCLUDED.captured_at,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;

  ELSIF NEW.status = 'ready' THEN
    UPDATE shared.customer_media
       SET actual_byte_size = NEW.actual_byte_size,
           width = NEW.width,
           height = NEW.height,
           etag = NEW.etag,
           status = 'ready',
           captured_by = COALESCE(NULLIF(NEW.captured_by, ''), captured_by),
           captured_at = COALESCE(NEW.captured_at, captured_at, now()),
           updated_at = now(),
           updated_by = v_actor
     WHERE installation_id = NEW.installation_id
       AND source_app = 'MCP'
       AND source_media_id = NEW.id
       AND status IN ('pending', 'ready');

    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed = 0 THEN
      PERFORM mcp.sync_route_customer_media_to_shared(NEW.route_customer_id);
    END IF;

  ELSIF NEW.status IN ('failed', 'deleted') THEN
    UPDATE shared.customer_media
       SET status = 'deleted',
           updated_at = now(),
           updated_by = v_actor
     WHERE installation_id = NEW.installation_id
       AND source_app = 'MCP'
       AND source_media_id = NEW.id
       AND status <> 'deleted';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION mcp.sync_outlet_media_shared_registry() FROM PUBLIC;

UPDATE mcp.mcp_outlet_media
   SET status = 'failed',
       raw_payload = COALESCE(raw_payload, '{}'::jsonb) ||
         jsonb_build_object('upload_reservation_expired_at', now()),
       updated_at = now()
 WHERE status = 'pending'
   AND updated_at < now() - interval '10 minutes';
