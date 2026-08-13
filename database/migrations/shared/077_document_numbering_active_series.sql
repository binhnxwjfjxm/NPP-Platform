-- Issue #497 Lane H: system-owned document identity and one active series per document type.
-- Reconciliation is append-safe: no series, counter, or allocation row is deleted.
-- When legacy data has multiple active series for one installation/document type, keep one
-- deterministic survivor and deactivate the others before installing the concurrency invariant.

WITH canonical_codes(document_type, canonical_code) AS (
  VALUES
    ('SALES_ORDER', 'SALES_ORDER'),
    ('PURCHASE_ORDER', 'PURCHASE_ORDER'),
    ('GOODS_RECEIPT', 'PURCHASE_RECEIPT'),
    ('DELIVERY_ORDER', 'DELIVERY_ORDER'),
    ('INVENTORY_TRANSFER', 'INVENTORY_TRANSFER'),
    ('INVENTORY_ADJUSTMENT', 'INVENTORY_ADJUSTMENT'),
    ('CUSTOMER_RETURN', 'CUSTOMER_RETURN'),
    ('SUPPLIER_RETURN', 'SUPPLIER_RETURN'),
    ('CUSTOMER_PAYMENT', 'CUSTOMER_PAYMENT'),
    ('SUPPLIER_PAYMENT', 'SUPPLIER_PAYMENT'),
    ('CUSTOMER_REFUND', 'CUSTOMER_REFUND'),
    ('GOODS_ISSUE', 'GOODS_ISSUE'),
    ('INVOICE', 'INVOICE')
), ranked AS (
  SELECT dns.id,
         row_number() OVER (
           PARTITION BY dns.installation_id, dns.document_type
           ORDER BY
             CASE WHEN dns.code = canonical_codes.canonical_code THEN 0 ELSE 1 END,
             (
               SELECT count(*)
                 FROM shared.document_number_allocations allocation
                WHERE allocation.installation_id = dns.installation_id
                  AND allocation.series_id = dns.id
             ) DESC,
             dns.created_at ASC,
             dns.id ASC
         ) AS active_rank
    FROM shared.document_number_series dns
    LEFT JOIN canonical_codes
      ON canonical_codes.document_type = dns.document_type
   WHERE dns.is_active = true
)
UPDATE shared.document_number_series dns
   SET is_active = false,
       updated_at = GREATEST(
         date_trunc('milliseconds', clock_timestamp()),
         dns.updated_at + interval '1 millisecond'
       ),
       updated_by = 'system:077_document_numbering_active_series'
  FROM ranked
 WHERE ranked.id = dns.id
   AND ranked.active_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS document_number_series_one_active_type_unique
  ON shared.document_number_series (installation_id, document_type)
  WHERE is_active = true;

COMMENT ON INDEX shared.document_number_series_one_active_type_unique IS
  'Issue #497 Lane H: at most one active document-number series per installation and document type.';
