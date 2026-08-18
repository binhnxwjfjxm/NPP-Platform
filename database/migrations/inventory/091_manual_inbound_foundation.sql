-- Issue #633 Lô 1: semantic and immutable document foundation for manual inbound.
-- Manual inbound is distinct from opening balance, stock adjustment and purchasing receipts.

CREATE TABLE IF NOT EXISTS inventory.manual_inbound_documents (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  inbound_type text NOT NULL CHECK (inbound_type IN (
    'MANUAL_RECEIPT',
    'OFF_DOCUMENT_CUSTOMER_RETURN',
    'RECOVERY',
    'OTHER'
  )),
  warehouse_id uuid NOT NULL,
  document_date date NOT NULL,
  reference_number text NULL CHECK (
    reference_number IS NULL OR char_length(btrim(reference_number)) BETWEEN 1 AND 160
  ),
  note text NULL CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 2000),
  movement_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT manual_inbound_documents_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT manual_inbound_documents_movement_unique UNIQUE (installation_id, movement_id),
  CONSTRAINT manual_inbound_documents_other_note_required CHECK (
    inbound_type <> 'OTHER' OR note IS NOT NULL
  ),
  CONSTRAINT manual_inbound_documents_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT manual_inbound_documents_movement_fk
    FOREIGN KEY (installation_id, movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS manual_inbound_documents_lookup_idx
  ON inventory.manual_inbound_documents (installation_id, document_date DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS manual_inbound_documents_reference_idx
  ON inventory.manual_inbound_documents (installation_id, reference_number)
  WHERE reference_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory.manual_inbound_document_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  document_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  source_variant_id uuid NOT NULL,
  source_sku text NOT NULL CHECK (char_length(source_sku) BETWEEN 1 AND 96),
  source_unit_id uuid NOT NULL,
  source_unit_code text NOT NULL CHECK (char_length(source_unit_code) BETWEEN 1 AND 32),
  source_quantity numeric(20,6) NOT NULL CHECK (source_quantity > 0),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  base_variant_id uuid NOT NULL,
  base_sku text NOT NULL CHECK (char_length(base_sku) BETWEEN 1 AND 96),
  base_quantity numeric(30,12) NOT NULL CHECK (base_quantity > 0),
  lot_id uuid NULL,
  lot_code text NULL,
  expiry_date date NULL,
  entered_unit_cost numeric(30,12) NULL CHECK (entered_unit_cost IS NULL OR entered_unit_cost > 0),
  currency_code text NULL CHECK (currency_code IS NULL OR currency_code = 'VND'),
  source_line_reference text NULL CHECK (
    source_line_reference IS NULL OR char_length(btrim(source_line_reference)) BETWEEN 1 AND 160
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT manual_inbound_document_lines_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT manual_inbound_document_lines_number_unique UNIQUE (installation_id, document_id, line_number),
  CONSTRAINT manual_inbound_document_lines_document_fk
    FOREIGN KEY (installation_id, document_id)
    REFERENCES inventory.manual_inbound_documents (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT manual_inbound_document_lines_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT manual_inbound_document_lines_location_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT manual_inbound_document_lines_source_variant_fk
    FOREIGN KEY (installation_id, source_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT manual_inbound_document_lines_source_unit_fk
    FOREIGN KEY (installation_id, source_unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT manual_inbound_document_lines_base_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT manual_inbound_document_lines_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS manual_inbound_document_lines_document_idx
  ON inventory.manual_inbound_document_lines (installation_id, document_id, line_number);

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.inventory-manual-inbound.read', 'Kho', 'Xem nhập kho thủ công', 'Cho phép xem chứng từ nhập kho thủ công trong phạm vi kho được cấp.', true, now()),
  ('core.inventory-manual-inbound.prepare', 'Kho', 'Chuẩn bị nhập kho thủ công', 'Cho phép chuẩn bị và kiểm tra dữ liệu chứng từ nhập kho thủ công trước khi xác nhận.', true, now()),
  ('core.inventory-manual-inbound.post', 'Kho', 'Xác nhận nhập kho thủ công', 'Cho phép xác nhận chứng từ và ghi Inventory IN chuẩn vào sổ kho.', true, now()),
  ('core.inventory-manual-inbound.reverse', 'Kho', 'Đảo nhập kho thủ công', 'Cho phép đảo chứng từ nhập kho thủ công đã ghi sổ bằng movement đảo có truy vết.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE OR REPLACE FUNCTION inventory.prevent_manual_inbound_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'manual_inbound_documents_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS manual_inbound_documents_append_only ON inventory.manual_inbound_documents;
CREATE TRIGGER manual_inbound_documents_append_only
BEFORE UPDATE OR DELETE ON inventory.manual_inbound_documents
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_manual_inbound_mutation();

DROP TRIGGER IF EXISTS manual_inbound_document_lines_append_only ON inventory.manual_inbound_document_lines;
CREATE TRIGGER manual_inbound_document_lines_append_only
BEFORE UPDATE OR DELETE ON inventory.manual_inbound_document_lines
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_manual_inbound_mutation();
