-- Phase 6 customer-boundary correction: MCP field profile verification is independent from orders.
-- Core remains the canonical customer authority; trusted MCP employee ownership is enforced at DB transition time.

ALTER TABLE sales.customer_onboarding_requests
  DROP CONSTRAINT IF EXISTS customer_onboarding_requests_trigger_reason_check,
  DROP CONSTRAINT IF EXISTS customer_onboarding_requests_source_contract_check;

ALTER TABLE sales.customer_onboarding_requests
  ADD CONSTRAINT customer_onboarding_requests_trigger_reason_check
    CHECK (trigger_reason IN ('OFFICIAL_ORDER_REQUIRED', 'CUSTOMER_REGISTRATION', 'FIELD_PROFILE_VERIFICATION')),
  ADD CONSTRAINT customer_onboarding_requests_source_contract_check CHECK (
    (
      source_system = 'MCP'
      AND order_required = true
      AND trigger_reason = 'OFFICIAL_ORDER_REQUIRED'
      AND requested_by_portal_user_id IS NULL
    )
    OR
    (
      source_system = 'MCP'
      AND order_required = false
      AND trigger_reason = 'FIELD_PROFILE_VERIFICATION'
      AND source_demand_reference = 'FIELD_PROFILE_VERIFICATION'
      AND requested_by_employee_id IS NOT NULL
      AND requested_by_portal_user_id IS NULL
    )
    OR
    (
      source_system = 'CUSTOMER_PORTAL'
      AND order_required = false
      AND trigger_reason = 'CUSTOMER_REGISTRATION'
      AND requested_by_portal_user_id IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION sales.enforce_mcp_field_profile_customer_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  employee_active boolean;
BEGIN
  IF NEW.source_system <> 'MCP'
     OR NEW.trigger_reason <> 'FIELD_PROFILE_VERIFICATION'
     OR NEW.status NOT IN ('approved', 'linked_existing') THEN
    RETURN NEW;
  END IF;

  IF NEW.requested_by_employee_id IS NULL OR NEW.approved_customer_id IS NULL THEN
    RAISE EXCEPTION 'mcp_field_profile_owner_required' USING ERRCODE = '23514';
  END IF;

  SELECT employee.is_active
    INTO employee_active
    FROM shared.employees AS employee
   WHERE employee.installation_id = NEW.installation_id
     AND employee.id = NEW.requested_by_employee_id
   FOR SHARE;

  IF employee_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'mcp_field_profile_employee_inactive' USING ERRCODE = '23514';
  END IF;

  UPDATE shared.customers AS customer
     SET responsible_employee_id = NEW.requested_by_employee_id,
         updated_at = GREATEST(date_trunc('milliseconds', clock_timestamp()), customer.updated_at + interval '1 millisecond'),
         updated_by = NEW.reviewed_by_actor_id
   WHERE customer.installation_id = NEW.installation_id
     AND customer.id = NEW.approved_customer_id
     AND customer.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mcp_field_profile_customer_inactive' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS customer_onboarding_mcp_field_profile_owner ON sales.customer_onboarding_requests;
CREATE TRIGGER customer_onboarding_mcp_field_profile_owner
BEFORE UPDATE OF status, approved_customer_id, requested_by_employee_id
ON sales.customer_onboarding_requests
FOR EACH ROW
EXECUTE FUNCTION sales.enforce_mcp_field_profile_customer_owner();
