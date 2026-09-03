-- A trip stop may originate from an order-only destination snapshot instead of a saved customer address.
-- Null customer_address_id intentionally means there is no canonical customer-address identity to group by.

ALTER TABLE logistics.trip_stops
  ALTER COLUMN customer_address_id DROP NOT NULL;
