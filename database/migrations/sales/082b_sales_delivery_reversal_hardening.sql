-- Lane D hardening: reversal may change only cancellation projection and revision metadata.
CREATE OR REPLACE FUNCTION sales.guard_delivery_order_reversal_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('npp.delivery_order_write_context', true)
       IS DISTINCT FROM 'delivery_reversal_service' THEN
    RAISE EXCEPTION 'delivery_order_reversal_requires_service_context';
  END IF;
  IF TG_OP <> 'UPDATE'
     OR OLD.status <> 'ready_to_dispatch'
     OR NEW.status <> 'cancelled'
     OR NEW.cancelled_at IS NULL
     OR NEW.cancelled_by IS NULL
     OR NEW.cancellation_reason IS NULL
     OR btrim(NEW.cancellation_reason) = ''
     OR NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
    RAISE EXCEPTION 'delivery_order_invalid_reversal_transition';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.delivery_order_number IS DISTINCT FROM OLD.delivery_order_number
     OR NEW.delivery_order_number_allocation_id IS DISTINCT FROM OLD.delivery_order_number_allocation_id
     OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
     OR NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.customer_address_id IS DISTINCT FROM OLD.customer_address_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.handover_mode IS DISTINCT FROM OLD.handover_mode
     OR NEW.customer_code_snapshot IS DISTINCT FROM OLD.customer_code_snapshot
     OR NEW.customer_name_snapshot IS DISTINCT FROM OLD.customer_name_snapshot
     OR NEW.destination_snapshot IS DISTINCT FROM OLD.destination_snapshot
     OR NEW.warehouse_code_snapshot IS DISTINCT FROM OLD.warehouse_code_snapshot
     OR NEW.warehouse_name_snapshot IS DISTINCT FROM OLD.warehouse_name_snapshot
     OR NEW.requested_delivery_date IS DISTINCT FROM OLD.requested_delivery_date
     OR NEW.collection_policy IS DISTINCT FROM OLD.collection_policy
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key
     OR NEW.create_payload_hash IS DISTINCT FROM OLD.create_payload_hash
     OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
     OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'delivery_order_reversal_cannot_rewrite_history';
  END IF;
  RETURN NEW;
END;
$$;
