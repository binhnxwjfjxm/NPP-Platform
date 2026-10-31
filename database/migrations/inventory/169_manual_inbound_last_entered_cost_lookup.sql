-- Index for confirmed manual inbound cost suggestions; no costing/ledger changes.
CREATE INDEX IF NOT EXISTS manual_inbound_last_entered_cost_lookup_idx
  ON inventory.manual_inbound_document_lines
    (installation_id, warehouse_id, source_variant_id, source_unit_id, document_id)
  WHERE entered_unit_cost > 0
    AND currency_code = 'VND'
    AND (metadata ->> 'manualInboundCostSource') IS DISTINCT FROM 'CURRENT';
