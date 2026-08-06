-- Phase 7.4: governed inventory adjustments, quarantine/damaged transfers and scrap.
-- The inventory ledger remains the sole stock source of truth. This migration never writes balances directly.
-- Optimistic concurrency and reversal gates reuse inventory.inventory_scope_versions from migration 060.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.inventory-adjustment.read', 'Kho', 'Xem phiếu xử lý tồn kho', 'Cho phép đọc phiếu điều chỉnh, cách ly, hư hỏng và tiêu hủy trong phạm vi kho được cấp.', true, now()),
  ('core.inventory-adjustment.create', 'Kho', 'Tạo phiếu xử lý tồn kho', 'Cho phép tạo phiếu điều chỉnh, chuyển cách ly, chuyển hư hỏng hoặc tiêu hủy.', true, now()),
  ('core.inventory-adjustment.submit', 'Kho', 'Gửi duyệt phiếu xử lý tồn kho', 'Cho phép gửi phiếu xử lý tồn kho để người khác duyệt.', true, now()),
  ('core.inventory-adjustment.approve', 'Kho', 'Duyệt phiếu xử lý tồn kho', 'Cho phép duyệt phiếu do người khác tạo trong phạm vi kho được cấp.', true, now()),
  ('core.inventory-adjustment.post', 'Kho', 'Ghi sổ phiếu xử lý tồn kho', 'Cho phép ghi movement append-only sau khi phiếu đã được duyệt.', true, now()),
  ('core.inventory-adjustment.cancel', 'Kho', 'Hủy phiếu xử lý tồn kho', 'Cho phép hủy phiếu trước khi ghi sổ với lý do bắt buộc.', true, now()),
  ('core.inventory-adjustment.reverse', 'Kho', 'Đảo phiếu xử lý tồn kho', 'Cho phép đảo movement khi chưa có movement phát sinh sau đó trên exact scope.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS inventory.inventory_adjustment_reasons (
  code text NOT NULL PRIMARY KEY CHECK (code ~ '^[A-Z0-9_.-]{1,64}$'),
  document_kind text NOT NULL CHECK (document_kind IN (
    'MANUAL_ADJUSTMENT', 'QUARANTINE_TRANSFER', 'DAMAGED_TRANSFER', 'SCRAP'
  )),
  adjustment_direction text NULL CHECK (adjustment_direction IS NULL OR adjustment_direction IN ('IN', 'OUT')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 1000),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_adjustment_reason_direction_ck CHECK (
    (document_kind = 'MANUAL_ADJUSTMENT' AND adjustment_direction IS NOT NULL)
    OR (document_kind <> 'MANUAL_ADJUSTMENT' AND adjustment_direction IS NULL)
  )
);

INSERT INTO inventory.inventory_adjustment_reasons (
  code, document_kind, adjustment_direction, label, description, is_active, sort_order
) VALUES
  ('MANUAL_COUNT_CORRECTION_IN', 'MANUAL_ADJUSTMENT', 'IN', 'Điều chỉnh tăng sau đối soát', 'Tăng tồn khi đã có căn cứ kiểm tra và không thuộc receipt/return domain khác.', true, 10),
  ('MANUAL_COUNT_CORRECTION_OUT', 'MANUAL_ADJUSTMENT', 'OUT', 'Điều chỉnh giảm sau đối soát', 'Giảm tồn khi đã có căn cứ kiểm tra và không thuộc issue/transfer domain khác.', true, 20),
  ('QUALITY_HOLD', 'QUARANTINE_TRANSFER', NULL, 'Chờ kiểm tra chất lượng', 'Chuyển hàng sang vị trí cách ly để ngừng cấp phát trong lúc chờ kết luận.', true, 30),
  ('DOCUMENT_VERIFICATION', 'QUARANTINE_TRANSFER', NULL, 'Chờ xác minh chứng từ', 'Cách ly hàng trong lúc đối chiếu nguồn gốc hoặc chứng từ liên quan.', true, 40),
  ('PHYSICAL_DAMAGE', 'DAMAGED_TRANSFER', NULL, 'Hư hỏng vật lý', 'Chuyển hàng đã xác định hư hỏng sang vị trí hư hỏng.', true, 50),
  ('QUALITY_FAILURE', 'DAMAGED_TRANSFER', NULL, 'Không đạt chất lượng', 'Chuyển hàng không đạt tiêu chuẩn sang vị trí hư hỏng.', true, 60),
  ('APPROVED_SCRAP_EXPIRED', 'SCRAP', NULL, 'Tiêu hủy hàng hết hạn', 'Tiêu hủy hàng hết hạn sau khi phiếu được duyệt.', true, 70),
  ('APPROVED_SCRAP_DAMAGED', 'SCRAP', NULL, 'Tiêu hủy hàng hư hỏng', 'Tiêu hủy hàng hư hỏng sau khi phiếu được duyệt.', true, 80)
ON CONFLICT (code) DO UPDATE
SET document_kind = EXCLUDED.document_kind,
    adjustment_direction = EXCLUDED.adjustment_direction,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS inventory.inventory_adjustments (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  adjustment_number text NOT NULL CHECK (char_length(btrim(adjustment_number)) BETWEEN 1 AND 64),
  warehouse_id uuid NOT NULL,
  document_kind text NOT NULL CHECK (document_kind IN (
    'MANUAL_ADJUSTMENT', 'QUARANTINE_TRANSFER', 'DAMAGED_TRANSFER', 'SCRAP'
  )),
  adjustment_direction text NULL CHECK (adjustment_direction IS NULL OR adjustment_direction IN ('IN', 'OUT')),
  reason_code text NOT NULL,
  reason_note text NOT NULL CHECK (char_length(btrim(reason_note)) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'CANCELLED', 'REVERSED'
  )),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  correction_of_adjustment_id uuid NULL,
  inventory_movement_id uuid NULL,
  reversal_movement_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  submitted_at timestamptz NULL,
  submitted_by text NULL,
  approved_at timestamptz NULL,
  approved_by text NULL,
  posted_at timestamptz NULL,
  posted_by text NULL,
  cancelled_at timestamptz NULL,
  cancelled_by text NULL,
  cancel_reason text NULL CHECK (cancel_reason IS NULL OR char_length(btrim(cancel_reason)) BETWEEN 1 AND 2000),
  reversed_at timestamptz NULL,
  reversed_by text NULL,
  reversal_reason text NULL CHECK (reversal_reason IS NULL OR char_length(btrim(reversal_reason)) BETWEEN 1 AND 2000),
  CONSTRAINT inventory_adjustments_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_adjustments_number_unique UNIQUE (installation_id, adjustment_number),
  CONSTRAINT inventory_adjustments_kind_direction_ck CHECK (
    (document_kind = 'MANUAL_ADJUSTMENT' AND adjustment_direction IS NOT NULL)
    OR (document_kind <> 'MANUAL_ADJUSTMENT' AND adjustment_direction IS NULL)
  ),
  CONSTRAINT inventory_adjustments_creator_approver_separation_ck CHECK (
    approved_by IS NULL OR approved_by <> created_by
  ),
  CONSTRAINT inventory_adjustments_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustments_reason_fk
    FOREIGN KEY (reason_code)
    REFERENCES inventory.inventory_adjustment_reasons (code)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustments_correction_fk
    FOREIGN KEY (installation_id, correction_of_adjustment_id)
    REFERENCES inventory.inventory_adjustments (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustments_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustments_reversal_movement_fk
    FOREIGN KEY (installation_id, reversal_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_adjustments_list_idx
  ON inventory.inventory_adjustments (installation_id, warehouse_id, status, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_adjustments_movement_unique
  ON inventory.inventory_adjustments (installation_id, inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_adjustments_reversal_movement_unique
  ON inventory.inventory_adjustments (installation_id, reversal_movement_id)
  WHERE reversal_movement_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory.inventory_adjustment_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  adjustment_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  warehouse_id uuid NOT NULL,
  source_location_id uuid NOT NULL,
  destination_location_id uuid NULL,
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
  source_snapshot_scope_version bigint NOT NULL CHECK (source_snapshot_scope_version >= 0),
  destination_snapshot_scope_version bigint NULL CHECK (
    destination_snapshot_scope_version IS NULL OR destination_snapshot_scope_version >= 0
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT inventory_adjustment_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_adjustment_lines_number_unique UNIQUE (installation_id, adjustment_id, line_number),
  CONSTRAINT inventory_adjustment_lines_scope_unique UNIQUE NULLS NOT DISTINCT (
    installation_id, adjustment_id, source_location_id, destination_location_id, base_variant_id, lot_id
  ),
  CONSTRAINT inventory_adjustment_lines_header_fk
    FOREIGN KEY (installation_id, adjustment_id)
    REFERENCES inventory.inventory_adjustments (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_lines_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_lines_source_location_fk
    FOREIGN KEY (installation_id, warehouse_id, source_location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_lines_destination_location_fk
    FOREIGN KEY (installation_id, warehouse_id, destination_location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_lines_source_variant_fk
    FOREIGN KEY (installation_id, source_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_lines_source_unit_fk
    FOREIGN KEY (installation_id, source_unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_lines_base_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_lines_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_adjustment_lines_scope_idx
  ON inventory.inventory_adjustment_lines (
    installation_id, warehouse_id, source_location_id, destination_location_id, base_variant_id, lot_id
  );

CREATE TABLE IF NOT EXISTS inventory.inventory_adjustment_posted_scopes (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  adjustment_id uuid NOT NULL,
  adjustment_line_id uuid NOT NULL,
  scope_side text NOT NULL CHECK (scope_side IN ('SOURCE', 'DESTINATION')),
  warehouse_id uuid NOT NULL,
  location_id uuid NOT NULL,
  base_variant_id uuid NOT NULL,
  lot_id uuid NULL,
  posted_scope_version bigint NOT NULL CHECK (posted_scope_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_adjustment_posted_scopes_unique UNIQUE (
    installation_id, adjustment_line_id, scope_side
  ),
  CONSTRAINT inventory_adjustment_posted_scopes_header_fk
    FOREIGN KEY (installation_id, adjustment_id)
    REFERENCES inventory.inventory_adjustments (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_posted_scopes_line_fk
    FOREIGN KEY (installation_id, adjustment_line_id)
    REFERENCES inventory.inventory_adjustment_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_posted_scopes_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_posted_scopes_location_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_posted_scopes_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_adjustment_posted_scopes_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION inventory.guard_inventory_adjustment_header()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reason_row inventory.inventory_adjustment_reasons%ROWTYPE;
BEGIN
  SELECT * INTO reason_row
    FROM inventory.inventory_adjustment_reasons
   WHERE code = NEW.reason_code;
  IF NOT FOUND OR reason_row.is_active = false THEN
    RAISE EXCEPTION 'inventory_adjustment_reason_not_available';
  END IF;
  IF reason_row.document_kind <> NEW.document_kind
     OR reason_row.adjustment_direction IS DISTINCT FROM NEW.adjustment_direction THEN
    RAISE EXCEPTION 'inventory_adjustment_reason_mismatch';
  END IF;
  IF NEW.correction_of_adjustment_id = NEW.id THEN
    RAISE EXCEPTION 'inventory_adjustment_self_correction_invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_adjustment_header_guard ON inventory.inventory_adjustments;
CREATE TRIGGER inventory_adjustment_header_guard
BEFORE INSERT OR UPDATE OF document_kind, adjustment_direction, reason_code, correction_of_adjustment_id
ON inventory.inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_adjustment_header();

CREATE OR REPLACE FUNCTION inventory.guard_inventory_adjustment_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  header_kind text;
  header_status text;
  source_purpose text;
  destination_purpose text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'inventory_adjustment_line_history_is_append_only';
  END IF;

  SELECT document_kind, status
    INTO header_kind, header_status
    FROM inventory.inventory_adjustments
   WHERE installation_id = NEW.installation_id
     AND id = NEW.adjustment_id;
  IF header_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'inventory_adjustment_lines_locked';
  END IF;

  SELECT location_type INTO source_purpose
    FROM shared.warehouse_locations
   WHERE installation_id = NEW.installation_id
     AND warehouse_id = NEW.warehouse_id
     AND id = NEW.source_location_id
     AND is_active = true;
  IF source_purpose IS NULL THEN
    RAISE EXCEPTION 'inventory_adjustment_source_location_not_available';
  END IF;

  IF NEW.destination_location_id IS NOT NULL THEN
    SELECT location_type INTO destination_purpose
      FROM shared.warehouse_locations
     WHERE installation_id = NEW.installation_id
       AND warehouse_id = NEW.warehouse_id
       AND id = NEW.destination_location_id
       AND is_active = true;
  END IF;

  IF header_kind = 'QUARANTINE_TRANSFER' THEN
    IF destination_purpose <> 'quarantine' OR NEW.source_location_id = NEW.destination_location_id THEN
      RAISE EXCEPTION 'inventory_adjustment_quarantine_destination_invalid';
    END IF;
  ELSIF header_kind = 'DAMAGED_TRANSFER' THEN
    IF destination_purpose <> 'damaged' OR NEW.source_location_id = NEW.destination_location_id THEN
      RAISE EXCEPTION 'inventory_adjustment_damaged_destination_invalid';
    END IF;
  ELSIF NEW.destination_location_id IS NOT NULL THEN
    RAISE EXCEPTION 'inventory_adjustment_destination_not_allowed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.guard_inventory_adjustment_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory_adjustment_history_is_append_only';
  END IF;

  IF OLD.installation_id <> NEW.installation_id
     OR OLD.adjustment_number <> NEW.adjustment_number
     OR OLD.warehouse_id <> NEW.warehouse_id
     OR OLD.document_kind <> NEW.document_kind
     OR OLD.adjustment_direction IS DISTINCT FROM NEW.adjustment_direction
     OR OLD.reason_code <> NEW.reason_code
     OR OLD.reason_note <> NEW.reason_note
     OR OLD.correction_of_adjustment_id IS DISTINCT FROM NEW.correction_of_adjustment_id
     OR OLD.created_at <> NEW.created_at
     OR OLD.created_by <> NEW.created_by THEN
    RAISE EXCEPTION 'inventory_adjustment_identity_is_immutable';
  END IF;

  IF NEW.status = OLD.status THEN
    RAISE EXCEPTION 'inventory_adjustment_history_is_append_only';
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('SUBMITTED', 'CANCELLED'))
    OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'CANCELLED'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('POSTED', 'CANCELLED'))
    OR (OLD.status = 'POSTED' AND NEW.status = 'REVERSED')
  ) THEN
    RAISE EXCEPTION 'inventory_adjustment_status_transition_invalid';
  END IF;

  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'inventory_adjustment_revision_invalid';
  END IF;

  IF NEW.status = 'SUBMITTED'
     AND (NEW.submitted_at IS NULL OR NEW.submitted_by IS NULL) THEN
    RAISE EXCEPTION 'inventory_adjustment_submission_lineage_required';
  ELSIF NEW.status = 'APPROVED'
     AND (NEW.approved_at IS NULL OR NEW.approved_by IS NULL) THEN
    RAISE EXCEPTION 'inventory_adjustment_approval_lineage_required';
  ELSIF NEW.status = 'POSTED'
     AND (NEW.posted_at IS NULL OR NEW.posted_by IS NULL OR NEW.inventory_movement_id IS NULL) THEN
    RAISE EXCEPTION 'inventory_adjustment_posting_lineage_required';
  ELSIF NEW.status = 'CANCELLED'
     AND (NEW.cancelled_at IS NULL OR NEW.cancelled_by IS NULL OR NEW.cancel_reason IS NULL) THEN
    RAISE EXCEPTION 'inventory_adjustment_cancellation_lineage_required';
  ELSIF NEW.status = 'REVERSED'
     AND (NEW.reversed_at IS NULL OR NEW.reversed_by IS NULL
          OR NEW.reversal_reason IS NULL OR NEW.reversal_movement_id IS NULL
          OR NEW.inventory_movement_id IS NULL) THEN
    RAISE EXCEPTION 'inventory_adjustment_reversal_lineage_required';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_adjustment_lifecycle_guard ON inventory.inventory_adjustments;
CREATE TRIGGER inventory_adjustment_lifecycle_guard
BEFORE UPDATE OR DELETE ON inventory.inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_adjustment_lifecycle();

DROP TRIGGER IF EXISTS inventory_adjustment_line_guard ON inventory.inventory_adjustment_lines;
CREATE TRIGGER inventory_adjustment_line_guard
BEFORE INSERT OR UPDATE OR DELETE ON inventory.inventory_adjustment_lines
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_adjustment_line();

CREATE OR REPLACE FUNCTION inventory.guard_inventory_adjustment_posted_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  line_row inventory.inventory_adjustment_lines%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'inventory_adjustment_posted_scope_is_append_only';
  END IF;

  SELECT * INTO line_row
    FROM inventory.inventory_adjustment_lines
   WHERE installation_id = NEW.installation_id
     AND adjustment_id = NEW.adjustment_id
     AND id = NEW.adjustment_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_adjustment_posted_scope_lineage_invalid';
  END IF;

  IF NEW.warehouse_id <> line_row.warehouse_id
     OR NEW.base_variant_id <> line_row.base_variant_id
     OR NEW.lot_id IS DISTINCT FROM line_row.lot_id
     OR (NEW.scope_side = 'SOURCE' AND NEW.location_id <> line_row.source_location_id)
     OR (NEW.scope_side = 'DESTINATION'
         AND (line_row.destination_location_id IS NULL
              OR NEW.location_id <> line_row.destination_location_id)) THEN
    RAISE EXCEPTION 'inventory_adjustment_posted_scope_lineage_invalid';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_adjustment_posted_scope_guard
ON inventory.inventory_adjustment_posted_scopes;
CREATE TRIGGER inventory_adjustment_posted_scope_guard
BEFORE INSERT OR UPDATE OR DELETE ON inventory.inventory_adjustment_posted_scopes
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_adjustment_posted_scope();
