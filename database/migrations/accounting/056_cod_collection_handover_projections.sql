CREATE OR REPLACE FUNCTION accounting.guard_cod_history()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  write_context text := current_setting('npp.cod_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'cod_service' THEN
    RAISE EXCEPTION 'cod_history_write_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'cod_history_is_append_only';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'cod_collections',
    'cod_collection_reversals',
    'cod_cash_handovers',
    'cod_cash_handover_lines',
    'cod_cash_handover_reversals',
    'cod_cash_acceptances',
    'cod_cash_acceptance_reversals'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_write_guard ON accounting.%I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_write_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting.%I FOR EACH ROW EXECUTE FUNCTION accounting.guard_cod_history()',
      table_name,
      table_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE VIEW accounting.cod_collection_custody AS
SELECT collection.installation_id,
       collection.id AS collection_id,
       collection.trip_id,
       collection.driver_profile_id,
       collection.currency_code,
       collection.received_amount,
       COALESCE(active_handover.handed_over_amount, 0::numeric) AS handed_over_amount,
       CASE
         WHEN collection.collection_method = 'CASH' AND collection_reversal.id IS NULL
           THEN GREATEST(collection.received_amount - COALESCE(active_handover.handed_over_amount, 0::numeric), 0::numeric)
         ELSE 0::numeric
       END AS custody_remaining_amount,
       collection_reversal.id IS NOT NULL AS reversed
  FROM accounting.cod_collections collection
  LEFT JOIN accounting.cod_collection_reversals collection_reversal
    ON collection_reversal.installation_id = collection.installation_id
   AND collection_reversal.collection_id = collection.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(line.handed_over_amount), 0::numeric) AS handed_over_amount
      FROM accounting.cod_cash_handover_lines line
      JOIN accounting.cod_cash_handovers handover
        ON handover.installation_id = line.installation_id
       AND handover.id = line.handover_id
      LEFT JOIN accounting.cod_cash_handover_reversals handover_reversal
        ON handover_reversal.installation_id = handover.installation_id
       AND handover_reversal.handover_id = handover.id
     WHERE line.installation_id = collection.installation_id
       AND line.collection_id = collection.id
       AND handover_reversal.id IS NULL
  ) active_handover ON true;

CREATE OR REPLACE VIEW accounting.cod_handover_projection AS
SELECT handover.*,
       handover_reversal.id AS reversal_id,
       handover_reversal.reason AS reversal_reason,
       handover_reversal.reversed_at,
       acceptance.id AS acceptance_id,
       acceptance.accepted_amount,
       acceptance.difference_amount AS acceptance_difference_amount,
       acceptance.reconciliation_status,
       acceptance.reason AS acceptance_reason,
       acceptance.note AS acceptance_note,
       acceptance.accepted_at,
       acceptance_reversal.id AS acceptance_reversal_id,
       CASE
         WHEN handover_reversal.id IS NOT NULL THEN 'reversed'
         WHEN acceptance.id IS NULL THEN 'submitted'
         WHEN acceptance_reversal.id IS NOT NULL THEN 'acceptance_reversed'
         WHEN acceptance.reconciliation_status = 'reconciled'
              AND handover.difference_amount = 0 THEN 'reconciled'
         ELSE 'discrepancy'
       END AS projection_status
  FROM accounting.cod_cash_handovers handover
  LEFT JOIN accounting.cod_cash_handover_reversals handover_reversal
    ON handover_reversal.installation_id = handover.installation_id
   AND handover_reversal.handover_id = handover.id
  LEFT JOIN accounting.cod_cash_acceptances acceptance
    ON acceptance.installation_id = handover.installation_id
   AND acceptance.handover_id = handover.id
  LEFT JOIN accounting.cod_cash_acceptance_reversals acceptance_reversal
    ON acceptance_reversal.installation_id = acceptance.installation_id
   AND acceptance_reversal.acceptance_id = acceptance.id;
