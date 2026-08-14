-- Task A / Issue #540: canonical map link belongs to the customer address.
-- Delivery snapshots consume this field in a later task; no Sales/Logistics schema is changed here.

ALTER TABLE shared.customer_addresses
  ADD COLUMN location_url text NULL;

ALTER TABLE shared.customer_addresses
  ADD CONSTRAINT customer_addresses_location_url_check
  CHECK (
    location_url IS NULL
    OR (
      location_url = btrim(location_url)
      AND char_length(location_url) BETWEEN 1 AND 2048
      AND location_url ~* '^https://[^[:space:]]+$'
    )
  );

COMMENT ON COLUMN shared.customer_addresses.location_url IS
  'Optional canonical HTTPS map/location URL for this customer address; user-editable coordinates are intentionally not stored.';
