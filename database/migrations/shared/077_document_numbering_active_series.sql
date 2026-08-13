-- Issue #497 Lane H: system-owned document identity and one active series per document type.
-- Reconciliation is append-safe: no series, counter, or allocation row is deleted.
-- PURCHASE_RECEIPT is the legacy Core identifier for the GOODS_RECEIPT business type;
-- both identifiers share one active-series invariant during the compatibility transition.

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
           PARTITION BY dns.installation_id,
             CASE
               WHEN dns.document_type = 'PURCHASE_RECEIPT' THEN 'GOODS_RECEIPT'
               ELSE dns.document_type
             END
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
      ON canonical_codes.document_type = CASE
           WHEN dns.document_type = 'PURCHASE_RECEIPT' THEN 'GOODS_RECEIPT'
           ELSE dns.document_type
         END
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
  ON shared.document_number_series (
    installation_id,
    (CASE
      WHEN document_type = 'PURCHASE_RECEIPT' THEN 'GOODS_RECEIPT'
      ELSE document_type
    END)
  )
  WHERE is_active = true;

COMMENT ON INDEX shared.document_number_series_one_active_type_unique IS
  'Issue #497 Lane H: at most one active document-number series per installation and canonical document type, including legacy PURCHASE_RECEIPT as GOODS_RECEIPT.';
