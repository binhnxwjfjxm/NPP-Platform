-- Bind MCP field sessions to the authenticated employee while keeping route masters shared.
-- Historical ownership is backfilled only from persisted authenticated user identity.
-- Never infer a session owner from route assignment, sales label, customer name or other shared data.

ALTER TABLE mcp.mcp_route_sessions
  ADD COLUMN IF NOT EXISTS owner_employee_id uuid NULL;

WITH identity_candidates AS (
  SELECT
    session.id,
    session.installation_id,
    COALESCE(
      NULLIF(session.raw_payload #>> '{foundation_context,employeeId}', ''),
      CASE
        WHEN (session.raw_payload #>> '{foundation_context,principalId}') LIKE 'user:%'
          THEN substring(session.raw_payload #>> '{foundation_context,principalId}' FROM 6)
        ELSE NULL
      END,
      CASE
        WHEN (session.raw_payload #>> '{foundation_context,actorId}') LIKE 'user:%'
          THEN substring(session.raw_payload #>> '{foundation_context,actorId}' FROM 6)
        ELSE NULL
      END
    ) AS employee_id_text
  FROM mcp.mcp_route_sessions AS session
  WHERE session.owner_employee_id IS NULL
), resolved_owner AS (
  SELECT candidate.id, employee.id AS employee_id
  FROM identity_candidates AS candidate
  JOIN shared.employees AS employee
    ON employee.installation_id = candidate.installation_id
   AND employee.id::text = candidate.employee_id_text
)
UPDATE mcp.mcp_route_sessions AS session
   SET owner_employee_id = resolved_owner.employee_id,
       updated_at = now()
  FROM resolved_owner
 WHERE session.id = resolved_owner.id
   AND session.owner_employee_id IS NULL;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'mcp_route_sessions_owner_employee_fk'
       AND conrelid = 'mcp.mcp_route_sessions'::regclass
  ) THEN
    ALTER TABLE mcp.mcp_route_sessions
      ADD CONSTRAINT mcp_route_sessions_owner_employee_fk
      FOREIGN KEY (installation_id, owner_employee_id)
      REFERENCES shared.employees (installation_id, id)
      ON DELETE RESTRICT;
  END IF;
END;
$migration$;

DROP INDEX IF EXISTS mcp.mcp_route_sessions_one_active_idx;
DROP INDEX IF EXISTS mcp.mcp_route_sessions_one_active_per_route_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS mcp_route_sessions_one_active_employee_idx
  ON mcp.mcp_route_sessions (installation_id, route_id, owner_employee_id)
  WHERE status = 'active' AND owner_employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mcp_route_sessions_one_active_service_idx
  ON mcp.mcp_route_sessions (installation_id, route_id)
  WHERE status = 'active' AND owner_employee_id IS NULL;

CREATE INDEX IF NOT EXISTS mcp_route_sessions_owner_history_idx
  ON mcp.mcp_route_sessions (installation_id, owner_employee_id, session_date DESC, updated_at DESC);
