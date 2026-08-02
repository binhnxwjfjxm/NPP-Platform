CREATE SCHEMA IF NOT EXISTS mcp;

ALTER TABLE mcp.mcp_route_sessions
  DROP CONSTRAINT IF EXISTS mcp_route_sessions_route_id_fkey;
ALTER TABLE mcp.mcp_route_sessions
  ADD CONSTRAINT mcp_route_sessions_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES mcp.mcp_routes(id) ON DELETE CASCADE;

ALTER TABLE mcp.mcp_session_customers
  DROP CONSTRAINT IF EXISTS mcp_session_customers_route_id_fkey;
ALTER TABLE mcp.mcp_session_customers
  ADD CONSTRAINT mcp_session_customers_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES mcp.mcp_routes(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION mcp.sync_route_session_visited_customers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  v_old_session_id text;
  v_new_session_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_session_id := OLD.session_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_session_id := NEW.session_id;
  END IF;

  IF v_old_session_id IS NOT NULL THEN
    UPDATE mcp.mcp_route_sessions session
    SET visited_customers = (
          SELECT COUNT(*)::integer
          FROM mcp.mcp_session_customers customer
          WHERE customer.installation_id = session.installation_id
            AND customer.session_id = session.id
            AND customer.visit_status = 'visited'
        ),
        updated_at = now()
    WHERE session.id = v_old_session_id;
  END IF;

  IF v_new_session_id IS NOT NULL AND v_new_session_id IS DISTINCT FROM v_old_session_id THEN
    UPDATE mcp.mcp_route_sessions session
    SET visited_customers = (
          SELECT COUNT(*)::integer
          FROM mcp.mcp_session_customers customer
          WHERE customer.installation_id = session.installation_id
            AND customer.session_id = session.id
            AND customer.visit_status = 'visited'
        ),
        updated_at = now()
    WHERE session.id = v_new_session_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mcp_session_customers_visited_counter
  ON mcp.mcp_session_customers;
CREATE TRIGGER mcp_session_customers_visited_counter
AFTER INSERT OR DELETE OR UPDATE OF visit_status, session_id
ON mcp.mcp_session_customers
FOR EACH ROW
EXECUTE FUNCTION mcp.sync_route_session_visited_customers();

UPDATE mcp.mcp_route_sessions session
SET visited_customers = (
      SELECT COUNT(*)::integer
      FROM mcp.mcp_session_customers customer
      WHERE customer.installation_id = session.installation_id
        AND customer.session_id = session.id
        AND customer.visit_status = 'visited'
    ),
    updated_at = now();

REVOKE ALL ON FUNCTION mcp.sync_route_session_visited_customers() FROM PUBLIC;
