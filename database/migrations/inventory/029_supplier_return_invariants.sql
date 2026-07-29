-- Phase 5.4 hardening: canonical movement identity and concurrency-safe source validation.

CREATE OR REPLACE FUNCTION inventory.canonicalize_supplier_return_movement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_domain = 'PURCHASING'
     AND NEW.source_document_type = 'SUPPLIER_RETURN' THEN
    IF NEW.movement_type NOT IN ('SUPPLIER_RETURN', 'SUPPLIER_RETURN_ISSUE') THEN
      RAISE EXCEPTION 'invalid_supplier_return_movement_type';
    END IF;
    NEW.movement_type := 'SUPPLIER_RETURN_ISSUE';
    IF NEW.reason_code = 'SUPPLIER_RETURN' THEN
      NEW.reason_code := 'SUPPLIER_RETURN_ISSUE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movements_supplier_return_canonical ON inventory.inventory_movements;
CREATE TRIGGER inventory_movements_supplier_return_canonical
BEFORE INSERT ON inventory.inventory_movements
FOR EACH ROW EXECUTE FUNCTION inventory.canonicalize_supplier_return_movement();

CREATE OR REPLACE FUNCTION purchasing.guard_supplier_return_submit_source_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'pending_approval' THEN
    PERFORM gr.id
      FROM purchasing.goods_receipts gr
     WHERE gr.installation_id = NEW.installation_id
       AND gr.id IN (
         SELECT DISTINCT srl.source_goods_receipt_id
           FROM purchasing.supplier_return_lines srl
          WHERE srl.installation_id = NEW.installation_id
            AND srl.supplier_return_id = NEW.id
       )
     ORDER BY gr.id
     FOR UPDATE;

    IF EXISTS (
      SELECT 1
        FROM purchasing.supplier_return_lines srl
        LEFT JOIN purchasing.goods_receipts gr
          ON gr.installation_id = srl.installation_id
         AND gr.id = srl.source_goods_receipt_id
       WHERE srl.installation_id = NEW.installation_id
         AND srl.supplier_return_id = NEW.id
         AND (gr.id IS NULL OR gr.status <> 'posted')
    ) THEN
      RAISE EXCEPTION 'supplier_return_source_receipt_not_posted';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_returns_submit_source_guard ON purchasing.supplier_returns;
CREATE TRIGGER supplier_returns_submit_source_guard
BEFORE UPDATE ON purchasing.supplier_returns
FOR EACH ROW EXECUTE FUNCTION purchasing.guard_supplier_return_submit_source_state();
