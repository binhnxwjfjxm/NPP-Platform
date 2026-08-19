-- Issue #622 production regression: Giao thủ công posts revenue directly from the Sales Order.
-- The business-shape constraint added in migration 090 already requires delivery_order_id
-- for ordinary delivery/pickup receivables and explicitly allows it to be NULL only for
-- MANUAL_SALES_ORDER. The base column remained NOT NULL, which made that valid branch
-- unreachable and surfaced as a generic 503 during Hoàn tất giao.

ALTER TABLE accounting.receivable_documents
  ALTER COLUMN delivery_order_id DROP NOT NULL;
