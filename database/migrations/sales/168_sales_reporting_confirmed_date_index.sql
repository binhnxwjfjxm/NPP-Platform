-- Reports filter on confirmed_at, not created_at. The historical sales indexes only
-- cover created_at; this index serves both the selected month and prior period.
-- Migration is gated separately: backup, restore rehearsal, production approval.
CREATE INDEX IF NOT EXISTS sales_orders_reporting_confirmed_date_idx
  ON sales.sales_orders (installation_id, confirmed_at, warehouse_id)
  WHERE confirmed_at IS NOT NULL;
