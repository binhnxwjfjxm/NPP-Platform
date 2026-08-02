ALTER TABLE mcp.mcp_outlet_media
  ALTER COLUMN session_id DROP NOT NULL;

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

  SELECT count(*)
    INTO v_active_media_count
  FROM mcp.mcp_outlet_media media
  WHERE media.installation_id = NEW.installation_id
    AND media.route_customer_id = NEW.route_customer_id
    AND media.status IN ('pending', 'ready', 'deleting', 'delete_failed')
    AND media.id IS DISTINCT FROM NEW.id;

  IF v_active_media_count >= 3 THEN
    RAISE EXCEPTION 'outlet_media_limit_reached' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mcp_outlet_media_limit ON mcp.mcp_outlet_media;
CREATE TRIGGER mcp_outlet_media_limit
BEFORE INSERT OR UPDATE OF installation_id, route_customer_id, status
ON mcp.mcp_outlet_media
FOR EACH ROW
EXECUTE FUNCTION mcp.enforce_outlet_media_limit();

REVOKE ALL ON FUNCTION mcp.enforce_outlet_media_limit() FROM PUBLIC;
