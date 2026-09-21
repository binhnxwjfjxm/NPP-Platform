-- Restore and preserve Công Ty runtime privileges after post-cutover migrations.
-- The VPS cutover granted the runtime role access to objects that existed at that time.
-- Later migrations must inherit the same intended access without manual production grants.

CREATE OR REPLACE FUNCTION shared.grant_company_runtime_access(p_role name)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  schema_name text;
  owner_name name := current_user;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_role::text) THEN
    RAISE EXCEPTION 'company runtime role % does not exist', p_role;
  END IF;

  FOREACH schema_name IN ARRAY ARRAY[
    'shared',
    'sales',
    'purchasing',
    'inventory',
    'logistics',
    'accounting',
    'reporting'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = schema_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', schema_name, p_role);
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I',
        schema_name,
        p_role
      );
      EXECUTE format(
        'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO %I',
        schema_name,
        p_role
      );
      EXECUTE format(
        'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO %I',
        schema_name,
        p_role
      );

      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
        owner_name,
        schema_name,
        p_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
        owner_name,
        schema_name,
        p_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO %I',
        owner_name,
        schema_name,
        p_role
      );
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION shared.grant_company_runtime_access(name)
IS 'Reconciles Công Ty database runtime access and default privileges for canonical business schemas.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npp_company_runtime') THEN
    PERFORM shared.grant_company_runtime_access('npp_company_runtime'::name);
  END IF;
END;
$$;
