-- Repair standalone customer verification projection introduced by mcp_010.
-- Runtime reads and writes this review reason on mcp_route_customers, not mcp.orders.

ALTER TABLE mcp.mcp_route_customers
  ADD COLUMN IF NOT EXISTS customer_onboarding_review_reason text NULL;
