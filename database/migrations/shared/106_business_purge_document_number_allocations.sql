-- Keep document-number allocation history immutable during normal operation while
-- allowing the authorised, transaction-scoped business-data purge to remove it.
-- Number-series configuration remains outside OPERATIONS_ONLY and is not changed here.

CREATE OR REPLACE FUNCTION shared.prevent_document_number_allocation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND shared.business_purge_delete_allowed(OLD.installation_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'document_number_allocations_are_append_only';
END;
$$;
