-- Keep Sales Order header invariants aligned with optional delivery addresses.
-- Delivery status remains required for delivery orders, while a customer address
-- may be supplied later or omitted for manual fulfilment.

ALTER TABLE sales.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_delivery_shape_check;

ALTER TABLE sales.sales_orders
  ADD CONSTRAINT sales_orders_delivery_shape_check CHECK (
    (delivery_mode = 'DELIVERY' AND delivery_status <> 'not_required')
    OR (delivery_mode = 'PICKUP' AND delivery_status IN ('not_required', 'cancelled'))
  );
