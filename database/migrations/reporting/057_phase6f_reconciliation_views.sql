-- Phase 6F.5: rebuildable read-only reconciliation views. No business mutation.
CREATE SCHEMA IF NOT EXISTS reporting;

CREATE OR REPLACE VIEW reporting.phase6f_document_reconciliation AS
WITH ledger AS (
  SELECT installation_id, receivable_document_id, COALESCE(sum(amount), 0::numeric) AS ledger_amount
  FROM accounting.receivable_ledger_entries GROUP BY installation_id, receivable_document_id
), active_allocations AS (
  SELECT allocation.installation_id, allocation.source_receivable_document_id,
         allocation.target_receivable_document_id, allocation.amount
  FROM accounting.receivable_allocations allocation
  LEFT JOIN accounting.receivable_allocation_reversals reversal
    ON reversal.installation_id=allocation.installation_id AND reversal.allocation_id=allocation.id
  WHERE reversal.id IS NULL
), allocation_totals AS (
  SELECT document.installation_id, document.id AS receivable_document_id,
         COALESCE(sum(CASE
           WHEN document.direction='CREDIT' AND allocation.source_receivable_document_id=document.id THEN allocation.amount
           WHEN document.direction='DEBIT' AND allocation.target_receivable_document_id=document.id THEN allocation.amount
           ELSE 0::numeric END), 0::numeric) AS active_allocated_amount
  FROM accounting.receivable_documents document
  LEFT JOIN active_allocations allocation ON allocation.installation_id=document.installation_id
    AND (allocation.source_receivable_document_id=document.id OR allocation.target_receivable_document_id=document.id)
  GROUP BY document.installation_id, document.id
)
SELECT document.installation_id, document.id, document.customer_id, document.warehouse_id,
       document.sales_order_id, document.delivery_order_id, document.document_type, document.direction,
       document.source_document_type, document.source_document_id, document.source_document_number,
       document.source_document_date, document.customer_code_snapshot, document.customer_name_snapshot,
       document.warehouse_code_snapshot, document.warehouse_name_snapshot, document.currency_code,
       document.original_amount, document.allocated_amount AS projected_allocated_amount,
       document.remaining_amount AS projected_remaining_amount, document.status AS document_status,
       COALESCE(ledger.ledger_amount,0::numeric) AS ledger_amount,
       allocation_totals.active_allocated_amount,
       document.original_amount-allocation_totals.active_allocated_amount AS calculated_remaining_amount,
       CASE WHEN document.status='reversed' THEN 0::numeric
            WHEN document.direction='DEBIT' THEN document.original_amount ELSE -document.original_amount END AS expected_ledger_amount,
       COALESCE(ledger.ledger_amount,0::numeric)=CASE WHEN document.status='reversed' THEN 0::numeric
            WHEN document.direction='DEBIT' THEN document.original_amount ELSE -document.original_amount END AS ledger_matches,
       document.allocated_amount=allocation_totals.active_allocated_amount
         AND document.remaining_amount=document.original_amount-allocation_totals.active_allocated_amount AS allocation_projection_matches,
       CASE WHEN COALESCE(ledger.ledger_amount,0::numeric)=CASE WHEN document.status='reversed' THEN 0::numeric
              WHEN document.direction='DEBIT' THEN document.original_amount ELSE -document.original_amount END
          AND document.allocated_amount=allocation_totals.active_allocated_amount
          AND document.remaining_amount=document.original_amount-allocation_totals.active_allocated_amount
         THEN 'matched' ELSE 'mismatch' END AS reconciliation_status
FROM accounting.receivable_documents document
LEFT JOIN ledger ON ledger.installation_id=document.installation_id AND ledger.receivable_document_id=document.id
JOIN allocation_totals ON allocation_totals.installation_id=document.installation_id
 AND allocation_totals.receivable_document_id=document.id;

CREATE OR REPLACE VIEW reporting.phase6f_customer_balance_reconciliation AS
WITH documents AS (
  SELECT installation_id, customer_id, currency_code,
         COALESCE(sum(CASE WHEN document_status='reversed' THEN 0 WHEN direction='DEBIT' THEN projected_remaining_amount ELSE -projected_remaining_amount END),0::numeric) AS calculated_open_balance,
         count(*) FILTER (WHERE reconciliation_status='mismatch')::bigint AS document_mismatch_count
  FROM reporting.phase6f_document_reconciliation GROUP BY installation_id, customer_id, currency_code
), ledger AS (
  SELECT installation_id, customer_id, currency_code, COALESCE(sum(amount),0::numeric) AS ledger_balance
  FROM accounting.receivable_ledger_entries GROUP BY installation_id, customer_id, currency_code
)
SELECT documents.installation_id, documents.customer_id, customer.code AS customer_code,
       customer.name AS customer_name, documents.currency_code, documents.calculated_open_balance,
       COALESCE(ledger.ledger_balance,0::numeric) AS ledger_balance,
       COALESCE(balance.balance,0::numeric) AS projected_balance, documents.document_mismatch_count,
       documents.calculated_open_balance=COALESCE(ledger.ledger_balance,0::numeric) AS open_balance_matches,
       COALESCE(ledger.ledger_balance,0::numeric)=COALESCE(balance.balance,0::numeric) AS balance_projection_matches,
       CASE WHEN documents.document_mismatch_count=0
          AND documents.calculated_open_balance=COALESCE(ledger.ledger_balance,0::numeric)
          AND COALESCE(ledger.ledger_balance,0::numeric)=COALESCE(balance.balance,0::numeric)
         THEN 'matched' ELSE 'mismatch' END AS reconciliation_status
FROM documents
JOIN shared.customers customer ON customer.installation_id=documents.installation_id AND customer.id=documents.customer_id
LEFT JOIN ledger ON ledger.installation_id=documents.installation_id AND ledger.customer_id=documents.customer_id AND ledger.currency_code=documents.currency_code
LEFT JOIN accounting.customer_receivable_balances balance ON balance.installation_id=documents.installation_id AND balance.customer_id=documents.customer_id AND balance.currency_code=documents.currency_code;

CREATE OR REPLACE VIEW reporting.phase6f_order_status_projection AS
WITH receivable AS (
  SELECT installation_id, sales_order_id,
         COALESCE(sum(CASE WHEN direction='DEBIT' AND document_status<>'reversed' THEN original_amount ELSE 0 END),0::numeric) AS receivable_posted_amount,
         COALESCE(sum(CASE WHEN direction='DEBIT' AND document_status<>'reversed' THEN projected_allocated_amount ELSE 0 END),0::numeric) AS receivable_allocated_amount,
         COALESCE(sum(CASE WHEN direction='DEBIT' AND document_status<>'reversed' THEN projected_remaining_amount ELSE 0 END),0::numeric) AS receivable_remaining_amount,
         count(*) FILTER (WHERE reconciliation_status='mismatch')::bigint AS document_mismatch_count
  FROM reporting.phase6f_document_reconciliation WHERE sales_order_id IS NOT NULL
  GROUP BY installation_id, sales_order_id
), cod AS (
  SELECT collection.installation_id, source.sales_order_id,
         COALESCE(sum(CASE WHEN reversal.id IS NULL AND collection.collection_method<>'NONE' THEN collection.received_amount ELSE 0 END),0::numeric) AS cod_collected_amount,
         COALESCE(sum(CASE WHEN reversal.id IS NULL AND collection.collection_method='CASH' THEN custody.custody_remaining_amount ELSE 0 END),0::numeric) AS cod_custody_amount
  FROM accounting.cod_collections collection
  JOIN accounting.receivable_documents source ON source.installation_id=collection.installation_id AND source.id=collection.source_receivable_document_id
  LEFT JOIN accounting.cod_collection_reversals reversal ON reversal.installation_id=collection.installation_id AND reversal.collection_id=collection.id
  LEFT JOIN accounting.cod_collection_custody custody ON custody.installation_id=collection.installation_id AND custody.collection_id=collection.id
  GROUP BY collection.installation_id, source.sales_order_id
)
SELECT sales_order.installation_id, sales_order.id AS sales_order_id, sales_order.order_number,
       sales_order.customer_id, customer.code AS customer_code, customer.name AS customer_name,
       sales_order.warehouse_id, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
       sales_order.currency_code, sales_order.status AS order_status, sales_order.fulfillment_status,
       sales_order.delivery_status, sales_order.settlement_status,
       COALESCE(receivable.receivable_posted_amount,0::numeric) AS receivable_posted_amount,
       COALESCE(receivable.receivable_allocated_amount,0::numeric) AS receivable_allocated_amount,
       COALESCE(receivable.receivable_remaining_amount,0::numeric) AS receivable_remaining_amount,
       COALESCE(cod.cod_collected_amount,0::numeric) AS cod_collected_amount,
       COALESCE(cod.cod_custody_amount,0::numeric) AS cod_custody_amount,
       COALESCE(receivable.document_mismatch_count,0::bigint) AS document_mismatch_count,
       CASE WHEN COALESCE(receivable.receivable_posted_amount,0)=0 THEN 'not_due'
            WHEN COALESCE(receivable.receivable_remaining_amount,0)=0 THEN 'paid'
            WHEN receivable.receivable_remaining_amount<receivable.receivable_posted_amount THEN 'partially_paid'
            ELSE 'pending' END AS calculated_settlement_status,
       CASE WHEN sales_order.settlement_status IN ('overpaid','refunded','written_off') THEN true
            ELSE sales_order.settlement_status=CASE WHEN COALESCE(receivable.receivable_posted_amount,0)=0 THEN 'not_due'
              WHEN COALESCE(receivable.receivable_remaining_amount,0)=0 THEN 'paid'
              WHEN receivable.receivable_remaining_amount<receivable.receivable_posted_amount THEN 'partially_paid' ELSE 'pending' END END AS settlement_projection_matches,
       CASE WHEN COALESCE(receivable.document_mismatch_count,0)=0 AND (
          sales_order.settlement_status IN ('overpaid','refunded','written_off') OR
          sales_order.settlement_status=CASE WHEN COALESCE(receivable.receivable_posted_amount,0)=0 THEN 'not_due'
            WHEN COALESCE(receivable.receivable_remaining_amount,0)=0 THEN 'paid'
            WHEN receivable.receivable_remaining_amount<receivable.receivable_posted_amount THEN 'partially_paid' ELSE 'pending' END)
         THEN 'matched' ELSE 'mismatch' END AS reconciliation_status,
       sales_order.updated_at
FROM sales.sales_orders sales_order
JOIN shared.customers customer ON customer.installation_id=sales_order.installation_id AND customer.id=sales_order.customer_id
JOIN shared.warehouses warehouse ON warehouse.installation_id=sales_order.installation_id AND warehouse.id=sales_order.warehouse_id
LEFT JOIN receivable ON receivable.installation_id=sales_order.installation_id AND receivable.sales_order_id=sales_order.id
LEFT JOIN cod ON cod.installation_id=sales_order.installation_id AND cod.sales_order_id=sales_order.id;

CREATE OR REPLACE VIEW reporting.phase6f_cod_collection_reconciliation AS
SELECT collection.installation_id, collection.id AS collection_id, collection.customer_id,
       customer.code AS customer_code, customer.name AS customer_name, collection.warehouse_id,
       warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, collection.trip_id,
       trip.trip_number, collection.delivery_order_id, delivery_order.delivery_order_number,
       collection.driver_profile_id, driver.code AS driver_code, driver.name AS driver_name,
       collection.collection_method, collection.collection_status, collection.currency_code,
       collection.expected_amount, collection.received_amount,
       COALESCE(custody.handed_over_amount,0::numeric) AS handed_over_amount,
       COALESCE(custody.custody_remaining_amount,0::numeric) AS custody_remaining_amount,
       reversal.id IS NOT NULL AS reversed, collection.collected_at, collection.payment_document_id,
       CASE WHEN reversal.id IS NOT NULL THEN 0::numeric
            WHEN collection.collection_method='CASH' THEN COALESCE(custody.handed_over_amount,0)+COALESCE(custody.custody_remaining_amount,0)
            ELSE collection.received_amount END AS lifecycle_accounted_amount,
       CASE WHEN reversal.id IS NOT NULL THEN true
            WHEN collection.collection_method='NONE' THEN collection.received_amount=0 AND collection.payment_document_id IS NULL
            WHEN collection.collection_method='CASH' THEN collection.received_amount=COALESCE(custody.handed_over_amount,0)+COALESCE(custody.custody_remaining_amount,0)
            ELSE collection.received_amount>0 AND collection.payment_document_id IS NOT NULL END AS lifecycle_matches,
       CASE WHEN reversal.id IS NOT NULL THEN 'reversed'
            WHEN collection.collection_method='CASH' AND COALESCE(custody.custody_remaining_amount,0)>0 THEN 'driver_custody'
            WHEN collection.collection_method='CASH' THEN 'handed_over'
            WHEN collection.collection_method='BANK_TRANSFER' THEN 'settled_non_cash' ELSE 'not_collected' END AS lifecycle_status
FROM accounting.cod_collections collection
JOIN shared.customers customer ON customer.installation_id=collection.installation_id AND customer.id=collection.customer_id
JOIN shared.warehouses warehouse ON warehouse.installation_id=collection.installation_id AND warehouse.id=collection.warehouse_id
JOIN logistics.delivery_trips trip ON trip.installation_id=collection.installation_id AND trip.id=collection.trip_id
JOIN sales.delivery_orders delivery_order ON delivery_order.installation_id=collection.installation_id AND delivery_order.id=collection.delivery_order_id
JOIN logistics.driver_profiles driver ON driver.installation_id=collection.installation_id AND driver.id=collection.driver_profile_id
LEFT JOIN accounting.cod_collection_custody custody ON custody.installation_id=collection.installation_id AND custody.collection_id=collection.id
LEFT JOIN accounting.cod_collection_reversals reversal ON reversal.installation_id=collection.installation_id AND reversal.collection_id=collection.id;

CREATE OR REPLACE VIEW reporting.phase6f_cod_handover_reconciliation AS
SELECT projection.installation_id, projection.id AS handover_id, projection.warehouse_id,
       warehouse.code AS warehouse_code, warehouse.name AS warehouse_name, projection.trip_id,
       trip.trip_number, projection.driver_profile_id, driver.code AS driver_code, driver.name AS driver_name,
       projection.expected_total, projection.handed_over_total, projection.unattributed_excess_amount,
       projection.handed_over_total+projection.unattributed_excess_amount AS claimed_amount,
       projection.difference_amount AS handover_difference_amount,
       CASE WHEN projection.projection_status IN ('submitted','acceptance_reversed')
         THEN projection.handed_over_total+projection.unattributed_excess_amount ELSE 0::numeric END AS pending_acceptance_amount,
       CASE WHEN projection.acceptance_id IS NOT NULL AND projection.acceptance_reversal_id IS NULL
         THEN projection.accepted_amount ELSE 0::numeric END AS accepted_amount,
       CASE WHEN projection.acceptance_id IS NOT NULL AND projection.acceptance_reversal_id IS NULL
         THEN projection.handed_over_total+projection.unattributed_excess_amount-projection.accepted_amount ELSE 0::numeric END AS variance_amount,
       projection.projection_status, projection.handed_over_at, projection.accepted_at, projection.reversed_at,
       CASE WHEN projection.projection_status='reversed' THEN true
            ELSE projection.handed_over_total+projection.unattributed_excess_amount=
             (CASE WHEN projection.projection_status IN ('submitted','acceptance_reversed') THEN projection.handed_over_total+projection.unattributed_excess_amount ELSE 0 END)
             +(CASE WHEN projection.acceptance_id IS NOT NULL AND projection.acceptance_reversal_id IS NULL THEN projection.accepted_amount ELSE 0 END)
             +(CASE WHEN projection.acceptance_id IS NOT NULL AND projection.acceptance_reversal_id IS NULL THEN projection.handed_over_total+projection.unattributed_excess_amount-projection.accepted_amount ELSE 0 END)
       END AS lifecycle_matches
FROM accounting.cod_handover_projection projection
JOIN shared.warehouses warehouse ON warehouse.installation_id=projection.installation_id AND warehouse.id=projection.warehouse_id
JOIN logistics.delivery_trips trip ON trip.installation_id=projection.installation_id AND trip.id=projection.trip_id
JOIN logistics.driver_profiles driver ON driver.installation_id=projection.installation_id AND driver.id=projection.driver_profile_id;

CREATE OR REPLACE VIEW reporting.phase6f_closeout_anomalies AS
SELECT installation_id, warehouse_id, 'receivable_document'::text AS anomaly_type, id::text AS source_id,
       source_document_number AS source_number, reconciliation_status,
       jsonb_build_object('ledgerMatches',ledger_matches,'allocationProjectionMatches',allocation_projection_matches,
         'expectedLedgerAmount',expected_ledger_amount,'ledgerAmount',ledger_amount,
         'projectedRemainingAmount',projected_remaining_amount,'calculatedRemainingAmount',calculated_remaining_amount) AS details
FROM reporting.phase6f_document_reconciliation WHERE reconciliation_status='mismatch'
UNION ALL
SELECT balance.installation_id, warehouse.id, 'customer_balance_projection', balance.customer_id::text,
       balance.customer_code, balance.reconciliation_status,
       jsonb_build_object('ledgerBalance',balance.ledger_balance,'projectedBalance',balance.projected_balance,
         'calculatedOpenBalance',balance.calculated_open_balance,'documentMismatchCount',balance.document_mismatch_count)
FROM reporting.phase6f_customer_balance_reconciliation balance
JOIN LATERAL (SELECT DISTINCT document.warehouse_id AS id FROM accounting.receivable_documents document
  WHERE document.installation_id=balance.installation_id AND document.customer_id=balance.customer_id
    AND document.currency_code=balance.currency_code) warehouse ON true
WHERE balance.reconciliation_status='mismatch'
UNION ALL
SELECT installation_id, warehouse_id, 'sales_order_status', sales_order_id::text,
       COALESCE(order_number,sales_order_id::text), reconciliation_status,
       jsonb_build_object('settlementStatus',settlement_status,'calculatedSettlementStatus',calculated_settlement_status,
         'documentMismatchCount',document_mismatch_count)
FROM reporting.phase6f_order_status_projection WHERE reconciliation_status='mismatch'
UNION ALL
SELECT installation_id, warehouse_id, 'cod_collection', collection_id::text,
       COALESCE(delivery_order_number,collection_id::text), 'mismatch',
       jsonb_build_object('receivedAmount',received_amount,'handedOverAmount',handed_over_amount,
         'custodyRemainingAmount',custody_remaining_amount,'lifecycleStatus',lifecycle_status)
FROM reporting.phase6f_cod_collection_reconciliation WHERE NOT lifecycle_matches
UNION ALL
SELECT installation_id, warehouse_id, 'cod_handover', handover_id::text,
       COALESCE(trip_number,handover_id::text), 'mismatch',
       jsonb_build_object('claimedAmount',claimed_amount,'pendingAcceptanceAmount',pending_acceptance_amount,
         'acceptedAmount',accepted_amount,'varianceAmount',variance_amount,'projectionStatus',projection_status)
FROM reporting.phase6f_cod_handover_reconciliation WHERE NOT lifecycle_matches;
