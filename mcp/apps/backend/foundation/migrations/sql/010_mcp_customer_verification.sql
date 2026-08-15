-- MCP customer boundary: durable employee ownership and standalone Core verification projection.
-- This is independent from mcp.orders and keeps Core customer IDs as references only.

ALTER TABLE mcp.mcp_route_customers
  ADD COLUMN IF NOT EXISTS responsible_employee_id uuid NULL,
  ADD COLUMN IF NOT EXISTS customer_verification_operation_id uuid NULL,
  ADD COLUMN IF NOT EXISTS customer_verification_idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS customer_verification_payload jsonb NULL,
  ADD COLUMN IF NOT EXISTS customer_verification_fingerprint text NULL,
  ADD COLUMN IF NOT EXISTS customer_verification_submitted_at timestamptz NULL;

ALTER TABLE mcp.mcp_route_customers
  DROP CONSTRAINT IF EXISTS mcp_route_customers_responsible_employee_fk,
  DROP CONSTRAINT IF EXISTS mcp_route_customers_verification_key_check,
  DROP CONSTRAINT IF EXISTS mcp_route_customers_verification_fingerprint_check,
  DROP CONSTRAINT IF EXISTS mcp_route_customers_verification_shape_check;

ALTER TABLE mcp.mcp_route_customers
  ADD CONSTRAINT mcp_route_customers_responsible_employee_fk
    FOREIGN KEY (installation_id, responsible_employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  ADD CONSTRAINT mcp_route_customers_verification_key_check
    CHECK (
      customer_verification_idempotency_key IS NULL
      OR customer_verification_idempotency_key ~ '^[A-Za-z0-9._-]{1,128}$'
    ),
  ADD CONSTRAINT mcp_route_customers_verification_fingerprint_check
    CHECK (
      customer_verification_fingerprint IS NULL
      OR customer_verification_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT mcp_route_customers_verification_shape_check CHECK (
    (
      customer_verification_operation_id IS NULL
      AND customer_verification_idempotency_key IS NULL
      AND customer_verification_payload IS NULL
      AND customer_verification_fingerprint IS NULL
    )
    OR
    (
      customer_verification_operation_id IS NOT NULL
      AND customer_verification_idempotency_key IS NOT NULL
      AND customer_verification_payload IS NOT NULL
      AND customer_verification_fingerprint IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS mcp_route_customers_responsible_employee_idx
  ON mcp.mcp_route_customers (installation_id, responsible_employee_id, active, updated_at DESC)
  WHERE responsible_employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mcp_route_customers_verification_operation_unique
  ON mcp.mcp_route_customers (installation_id, customer_verification_operation_id)
  WHERE customer_verification_operation_id IS NOT NULL;

UPDATE mcp.mcp_route_customers AS route_customer
   SET responsible_employee_id = customer.responsible_employee_id
  FROM shared.customers AS customer
 WHERE route_customer.responsible_employee_id IS NULL
   AND route_customer.installation_id = customer.installation_id
   AND customer.is_active = true
   AND customer.responsible_employee_id IS NOT NULL
   AND customer.id::text = COALESCE(route_customer.core_customer_id, route_customer.customer_id);
