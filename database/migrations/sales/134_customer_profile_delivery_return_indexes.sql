-- Customer 360 Lô 4: customer-scoped delivery and return history reads.
-- Read-performance only; no business data or lifecycle changes.

CREATE INDEX IF NOT EXISTS delivery_orders_customer_history_idx
  ON sales.delivery_orders (
    installation_id,
    customer_id,
    warehouse_id,
    created_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS customer_returns_customer_history_idx
  ON sales.customer_returns (
    installation_id,
    customer_id,
    warehouse_id,
    created_at DESC,
    id DESC
  );
