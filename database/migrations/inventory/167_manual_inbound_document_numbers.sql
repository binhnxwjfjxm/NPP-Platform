-- 167: canonical numbering for immutable manual inbound documents.
-- Do not mutate old documents or any inventory movements.
CREATE TABLE IF NOT EXISTS inventory.manual_inbound_document_numbers (
  installation_id text NOT NULL,
  document_id uuid NOT NULL,
  number_allocation_id uuid NOT NULL,
  document_number text NOT NULL CHECK (char_length(btrim(document_number)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, document_id),
  UNIQUE (installation_id, number_allocation_id),
  UNIQUE (installation_id, document_number),
  FOREIGN KEY (installation_id, document_id)
    REFERENCES inventory.manual_inbound_documents (installation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (installation_id, number_allocation_id)
    REFERENCES shared.document_number_allocations (installation_id, id) ON DELETE RESTRICT
);

-- Prevent silent series replacement or collisions with manually configured series.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM shared.document_number_series
    WHERE document_type = 'MANUAL_INBOUND'
    AND (code <> 'MANUAL_INBOUND' OR prefix <> 'NKT-'
      OR number_template <> '{PREFIX}{SEQ}' OR reset_policy <> 'NONE'
      OR sequence_width <> 8 OR start_counter <> 1 OR NOT is_active))
  THEN RAISE EXCEPTION 'manual_inbound_number_series_must_be_reconciled_before_167'; END IF;
  IF EXISTS (SELECT 1 FROM shared.document_number_series
    WHERE code = 'MANUAL_INBOUND' AND document_type <> 'MANUAL_INBOUND')
  THEN RAISE EXCEPTION 'manual_inbound_number_series_code_conflict'; END IF;
END $$;

INSERT INTO shared.document_number_series (
  id, installation_id, code, document_type, name, prefix, number_template,
  reset_policy, sequence_width, start_counter, timezone_name, description,
  is_active, created_by, updated_by
)
SELECT md5('manual-inbound-series-167:' || installation_id)::uuid,
       installation_id, 'MANUAL_INBOUND', 'MANUAL_INBOUND',
       'Phiếu nhập kho thủ công', 'NKT-', '{PREFIX}{SEQ}',
       'NONE', 8, 1, 'Asia/Ho_Chi_Minh',
       'Canonical numbering for manual inbound', true, 'system:migration', 'system:migration'
FROM (
  SELECT installation_id FROM shared.warehouses
  UNION SELECT installation_id FROM inventory.manual_inbound_documents
) installations
ON CONFLICT (installation_id, code) DO NOTHING;

-- Historical numbers follow document date, creation timestamp, then stable UUID.
-- Mapping and allocations are insert-only. The original ledger remains unchanged.
CREATE TEMP TABLE manual_inbound_number_backfill_167 ON COMMIT DROP AS
WITH ranked AS (
  SELECT d.installation_id, d.id AS document_id, d.document_date,
         d.created_by, d.request_id,
         row_number() OVER (
           PARTITION BY d.installation_id
           ORDER BY d.document_date, d.created_at, d.id
         ) AS seq
    FROM inventory.manual_inbound_documents d
)
SELECT r.*, 'NKT-' || lpad(r.seq::text, 8, '0') AS document_number,
       md5('manual-inbound-allocation-167:' || r.installation_id || ':' || r.document_id::text)::uuid AS allocation_id
  FROM ranked r
  LEFT JOIN inventory.manual_inbound_document_numbers n
    ON n.installation_id = r.installation_id AND n.document_id = r.document_id
 WHERE n.document_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM manual_inbound_number_backfill_167 WHERE seq > 99999999)
  THEN RAISE EXCEPTION 'manual_inbound_number_capacity_exceeded'; END IF;
  IF EXISTS (
    SELECT 1 FROM manual_inbound_number_backfill_167 b
    JOIN shared.document_number_allocations a
      ON a.installation_id = b.installation_id AND a.document_number = b.document_number
     AND a.id <> b.allocation_id
  ) THEN RAISE EXCEPTION 'manual_inbound_number_collision_with_existing_series'; END IF;
END $$;

INSERT INTO shared.document_number_allocations (
  id, installation_id, series_id, idempotency_key, document_date,
  period_key, counter_value, document_number, actor_id, request_id,
  source_app, metadata
)
SELECT b.allocation_id, b.installation_id, s.id,
       'manual-inbound-number-' || b.document_id::text,
       b.document_date, 'ALL', b.seq, b.document_number,
       b.created_by, b.request_id, 'npp-company-api',
       jsonb_build_object('manualInboundDocumentId', b.document_id)
  FROM manual_inbound_number_backfill_167 b
  JOIN shared.document_number_series s
    ON s.installation_id = b.installation_id
   AND s.document_type = 'MANUAL_INBOUND' AND s.is_active
ON CONFLICT (installation_id, series_id, idempotency_key) DO NOTHING;

INSERT INTO inventory.manual_inbound_document_numbers (
  installation_id, document_id, number_allocation_id, document_number
)
SELECT b.installation_id, b.document_id, a.id, a.document_number
  FROM manual_inbound_number_backfill_167 b
  JOIN shared.document_number_allocations a
    ON a.installation_id = b.installation_id AND a.id = b.allocation_id
   AND a.document_number = b.document_number
ON CONFLICT (installation_id, document_id) DO NOTHING;

-- Resume numbering after the latest historical allocation, never reuse an old number.
INSERT INTO shared.document_number_counters (
  installation_id, series_id, period_key, next_counter
)
SELECT s.installation_id, s.id, 'ALL', coalesce(max(a.counter_value), 0) + 1
  FROM shared.document_number_series s
  LEFT JOIN shared.document_number_allocations a
    ON a.installation_id = s.installation_id AND a.series_id = s.id
 WHERE s.document_type = 'MANUAL_INBOUND' AND s.is_active
 GROUP BY s.installation_id, s.id
ON CONFLICT (installation_id, series_id, period_key)
DO UPDATE SET next_counter = greatest(
  shared.document_number_counters.next_counter, excluded.next_counter
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM inventory.manual_inbound_documents d
    LEFT JOIN inventory.manual_inbound_document_numbers n
      ON n.installation_id = d.installation_id AND n.document_id = d.id
    WHERE n.document_id IS NULL
  ) THEN RAISE EXCEPTION 'manual_inbound_historical_number_reconciliation_failed'; END IF;
END $$;

CREATE OR REPLACE FUNCTION inventory.prevent_manual_inbound_number_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND shared.business_purge_delete_allowed(OLD.installation_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'manual_inbound_document_number_is_immutable';
END $$;

DROP TRIGGER IF EXISTS manual_inbound_document_numbers_append_only
  ON inventory.manual_inbound_document_numbers;
CREATE TRIGGER manual_inbound_document_numbers_append_only
  BEFORE UPDATE OR DELETE ON inventory.manual_inbound_document_numbers
  FOR EACH ROW EXECUTE FUNCTION inventory.prevent_manual_inbound_number_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npp_company_runtime') THEN
    PERFORM shared.grant_company_runtime_access('npp_company_runtime'::name);
  END IF;
END $$;
