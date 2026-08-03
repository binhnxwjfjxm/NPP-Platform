CREATE SCHEMA IF NOT EXISTS mcp;

ALTER TABLE mcp.orders
  ADD COLUMN IF NOT EXISTS customer_onboarding_request_id text,
  ADD COLUMN IF NOT EXISTS customer_onboarding_status text,
  ADD COLUMN IF NOT EXISTS customer_onboarding_version integer,
  ADD COLUMN IF NOT EXISTS customer_onboarding_fingerprint char(64),
  ADD COLUMN IF NOT EXISTS core_customer_id text,
  ADD COLUMN IF NOT EXISTS core_customer_address_id text,
  ADD COLUMN IF NOT EXISTS customer_onboarding_review_reason text,
  ADD COLUMN IF NOT EXISTS customer_onboarding_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_onboarding_last_synced_at timestamptz;

ALTER TABLE mcp.orders
  DROP CONSTRAINT IF EXISTS mcp_orders_customer_onboarding_status;
ALTER TABLE mcp.orders
  ADD CONSTRAINT mcp_orders_customer_onboarding_status
  CHECK (
    customer_onboarding_status IS NULL
    OR customer_onboarding_status IN (
      'submitted',
      'under_review',
      'need_more_info',
      'approved',
      'linked_existing',
      'rejected',
      'cancelled'
    )
  );

ALTER TABLE mcp.orders
  DROP CONSTRAINT IF EXISTS mcp_orders_customer_onboarding_shape;
ALTER TABLE mcp.orders
  ADD CONSTRAINT mcp_orders_customer_onboarding_shape
  CHECK (
    (
      customer_onboarding_request_id IS NULL
      AND customer_onboarding_status IS NULL
      AND customer_onboarding_version IS NULL
      AND customer_onboarding_fingerprint IS NULL
      AND core_customer_id IS NULL
      AND core_customer_address_id IS NULL
      AND customer_onboarding_review_reason IS NULL
      AND customer_onboarding_submitted_at IS NULL
      AND customer_onboarding_last_synced_at IS NULL
    )
    OR
    (
      customer_onboarding_request_id IS NOT NULL
      AND customer_onboarding_status IS NOT NULL
      AND customer_onboarding_version IS NOT NULL
      AND customer_onboarding_version > 0
      AND customer_onboarding_fingerprint ~ '^[0-9a-f]{64}$'
      AND customer_onboarding_submitted_at IS NOT NULL
      AND customer_onboarding_last_synced_at IS NOT NULL
    )
  );

ALTER TABLE mcp.orders
  DROP CONSTRAINT IF EXISTS mcp_orders_customer_onboarding_core_refs;
ALTER TABLE mcp.orders
  ADD CONSTRAINT mcp_orders_customer_onboarding_core_refs
  CHECK (
    (
      customer_onboarding_status IN ('approved', 'linked_existing')
      AND core_customer_id IS NOT NULL
      AND core_customer_address_id IS NOT NULL
    )
    OR
    (
      (customer_onboarding_status IS NULL OR customer_onboarding_status NOT IN ('approved', 'linked_existing'))
      AND core_customer_id IS NULL
      AND core_customer_address_id IS NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS mcp_orders_customer_onboarding_request_unique
  ON mcp.orders (installation_id, customer_onboarding_request_id)
  WHERE customer_onboarding_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mcp_orders_customer_onboarding_status_idx
  ON mcp.orders (installation_id, customer_onboarding_status, customer_onboarding_last_synced_at DESC)
  WHERE customer_onboarding_request_id IS NOT NULL;
