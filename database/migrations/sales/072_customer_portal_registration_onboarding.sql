-- Phase 9.8 closure: reuse canonical customer onboarding for Customer Ordering registrations.
-- MCP semantics remain unchanged; Customer Portal registrations use verified Clerk identity only.

ALTER TABLE sales.customer_onboarding_requests
  ADD COLUMN IF NOT EXISTS requested_by_portal_user_id uuid NULL;

ALTER TABLE sales.customer_onboarding_requests
  DROP CONSTRAINT IF EXISTS customer_onboarding_requests_source_system_check,
  DROP CONSTRAINT IF EXISTS customer_onboarding_requests_order_required_check,
  DROP CONSTRAINT IF EXISTS customer_onboarding_requests_trigger_reason_check,
  DROP CONSTRAINT IF EXISTS customer_onboarding_requests_source_contract_check,
  DROP CONSTRAINT IF EXISTS customer_onboarding_requests_portal_user_installation_fk;

ALTER TABLE sales.customer_onboarding_requests
  ADD CONSTRAINT customer_onboarding_requests_source_system_check
    CHECK (source_system IN ('MCP', 'CUSTOMER_PORTAL')),
  ADD CONSTRAINT customer_onboarding_requests_trigger_reason_check
    CHECK (trigger_reason IN ('OFFICIAL_ORDER_REQUIRED', 'CUSTOMER_REGISTRATION')),
  ADD CONSTRAINT customer_onboarding_requests_source_contract_check CHECK (
    (
      source_system = 'MCP'
      AND order_required = true
      AND trigger_reason = 'OFFICIAL_ORDER_REQUIRED'
      AND requested_by_portal_user_id IS NULL
    )
    OR
    (
      source_system = 'CUSTOMER_PORTAL'
      AND order_required = false
      AND trigger_reason = 'CUSTOMER_REGISTRATION'
      AND requested_by_portal_user_id IS NOT NULL
    )
  ),
  ADD CONSTRAINT customer_onboarding_requests_portal_user_installation_fk
    FOREIGN KEY (installation_id, requested_by_portal_user_id)
    REFERENCES shared.portal_users (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS customer_onboarding_requests_portal_user_idx
  ON sales.customer_onboarding_requests (installation_id, requested_by_portal_user_id, updated_at DESC)
  WHERE requested_by_portal_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_onboarding_requests_one_portal_registration_idx
  ON sales.customer_onboarding_requests (installation_id, requested_by_portal_user_id)
  WHERE source_system = 'CUSTOMER_PORTAL';
