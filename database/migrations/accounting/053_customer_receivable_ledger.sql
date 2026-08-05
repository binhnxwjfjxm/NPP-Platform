-- Phase 6F.1: customer receivable ledger posted from accepted delivery/pickup facts.
-- Payment/allocation, refund, write-off, COD handover and production backfill are not part of this migration.

CREATE SCHEMA IF NOT EXISTS accounting;

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES (
  'core.receivable.read',
  'Công nợ khách hàng',
  'Xem công nợ khách hàng',
  'Cho phép đọc số dư, chứng từ và sổ chi tiết công nợ khách hàng trong phạm vi kho được cấp.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS accounting.receivable_documents (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  customer_id uuid NOT NULL,
  customer_address_id uuid NULL,
  warehouse_id uuid NOT NULL,
  sales_order_id uuid NOT NULL,
  sales_order_version_id uuid NOT NULL,
  delivery_order_id uuid NOT NULL,
  direction text NOT NULL DEFAULT 'DEBIT' CHECK (direction IN ('DEBIT', 'CREDIT')),
  document_type text NOT NULL CHECK (document_type IN ('SALE_DELIVERY', 'SALE_PICKUP')),
  source_document_type text NOT NULL CHECK (source_document_type IN ('DELIVERY_ATTEMPT', 'PICKUP_HANDOVER')),
  source_document_id uuid NOT NULL,
  source_document_number text NOT NULL CHECK (char_length(btrim(source_document_number)) BETWEEN 1 AND 160),
  source_document_date date NOT NULL,
  customer_code_snapshot text NOT NULL CHECK (char_length(btrim(customer_code_snapshot)) BETWEEN 1 AND 64),
  customer_name_snapshot text NOT NULL CHECK (char_length(btrim(customer_name_snapshot)) BETWEEN 1 AND 256),
  warehouse_code_snapshot text NOT NULL CHECK (char_length(btrim(warehouse_code_snapshot)) BETWEEN 1 AND 64),
  warehouse_name_snapshot text NOT NULL CHECK (char_length(btrim(warehouse_name_snapshot)) BETWEEN 1 AND 256),
  collection_policy text NOT NULL CHECK (collection_policy IN (
    'PREPAID', 'COLLECT_ON_DELIVERY', 'COLLECT_AFTER_DELIVERY', 'CREDIT_TERMS'
  )),
  currency_code text NOT NULL CHECK (char_length(currency_code) = 3 AND currency_code = upper(currency_code)),
  original_amount numeric(20,6) NOT NULL CHECK (original_amount >= 0),
  allocated_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  remaining_amount numeric(20,6) NOT NULL CHECK (remaining_amount >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_allocated', 'settled', 'reversed')),
  source_revision bigint NOT NULL DEFAULT 1 CHECK (source_revision >= 1),
  posting_origin text NOT NULL DEFAULT 'runtime' CHECK (posting_origin IN ('runtime', 'migration_backfill')),
  posted_at timestamptz NOT NULL,
  posted_by text NOT NULL CHECK (char_length(posted_by) BETWEEN 1 AND 128),
  reversed_at timestamptz NULL,
  reversed_by text NULL CHECK (reversed_by IS NULL OR char_length(reversed_by) BETWEEN 1 AND 128),
  reversal_reason text NULL CHECK (reversal_reason IS NULL OR char_length(btrim(reversal_reason)) BETWEEN 1 AND 1000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT receivable_documents_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT receivable_documents_source_unique UNIQUE (
    installation_id, source_document_type, source_document_id
  ),
  CONSTRAINT receivable_documents_customer_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_documents_customer_address_fk
    FOREIGN KEY (installation_id, customer_address_id)
    REFERENCES shared.customer_addresses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_documents_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_documents_sales_order_fk
    FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_documents_sales_order_version_fk
    FOREIGN KEY (installation_id, sales_order_version_id)
    REFERENCES sales.sales_order_versions (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_documents_delivery_order_fk
    FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_documents_amount_check CHECK (
    allocated_amount <= original_amount
    AND remaining_amount = original_amount - allocated_amount
  ),
  CONSTRAINT receivable_documents_status_check CHECK (
    (status = 'open' AND allocated_amount = 0 AND remaining_amount = original_amount)
    OR (status = 'partially_allocated' AND allocated_amount > 0 AND remaining_amount > 0)
    OR (status = 'settled' AND remaining_amount = 0)
    OR (status = 'reversed' AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS receivable_documents_customer_idx
  ON accounting.receivable_documents (
    installation_id, customer_id, currency_code, source_document_date DESC, id
  );
CREATE INDEX IF NOT EXISTS receivable_documents_warehouse_status_idx
  ON accounting.receivable_documents (
    installation_id, warehouse_id, status, source_document_date DESC, id
  );
CREATE INDEX IF NOT EXISTS receivable_documents_sales_order_idx
  ON accounting.receivable_documents (installation_id, sales_order_id, source_document_date, id);

CREATE TABLE IF NOT EXISTS accounting.receivable_document_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  receivable_document_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 10000),
  sales_order_line_id uuid NOT NULL,
  delivery_order_line_id uuid NOT NULL,
  delivery_attempt_line_id uuid NULL,
  inventory_issue_line_id uuid NOT NULL,
  accepted_base_quantity numeric(30,12) NOT NULL CHECK (accepted_base_quantity > 0),
  sales_line_base_quantity_snapshot numeric(30,12) NOT NULL CHECK (sales_line_base_quantity_snapshot > 0),
  sku_snapshot text NOT NULL CHECK (char_length(btrim(sku_snapshot)) BETWEEN 1 AND 96),
  item_name_snapshot text NOT NULL CHECK (char_length(btrim(item_name_snapshot)) BETWEEN 1 AND 256),
  unit_code_snapshot text NOT NULL CHECK (char_length(btrim(unit_code_snapshot)) BETWEEN 1 AND 32),
  gross_amount numeric(20,6) NOT NULL CHECK (gross_amount >= 0),
  discount_amount numeric(20,6) NOT NULL CHECK (discount_amount >= 0),
  tax_amount numeric(20,6) NOT NULL CHECK (tax_amount >= 0),
  line_amount numeric(20,6) NOT NULL CHECK (line_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT receivable_document_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT receivable_document_lines_number_unique UNIQUE (
    installation_id, receivable_document_id, line_number
  ),
  CONSTRAINT receivable_document_lines_source_unique UNIQUE (
    installation_id, inventory_issue_line_id, receivable_document_id
  ),
  CONSTRAINT receivable_document_lines_document_fk
    FOREIGN KEY (installation_id, receivable_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_document_lines_sales_line_fk
    FOREIGN KEY (installation_id, sales_order_line_id)
    REFERENCES sales.sales_order_version_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_document_lines_delivery_line_fk
    FOREIGN KEY (installation_id, delivery_order_line_id)
    REFERENCES sales.delivery_order_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_document_lines_attempt_line_fk
    FOREIGN KEY (installation_id, delivery_attempt_line_id)
    REFERENCES logistics.delivery_attempt_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_document_lines_issue_line_fk
    FOREIGN KEY (installation_id, inventory_issue_line_id)
    REFERENCES sales.delivery_order_inventory_issue_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_document_lines_amount_check CHECK (
    line_amount = gross_amount - discount_amount + tax_amount
  )
);

CREATE INDEX IF NOT EXISTS receivable_document_lines_sales_line_idx
  ON accounting.receivable_document_lines (
    installation_id, sales_order_line_id, receivable_document_id
  );

CREATE TABLE IF NOT EXISTS accounting.receivable_ledger_entries (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  receivable_document_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  currency_code text NOT NULL CHECK (char_length(currency_code) = 3 AND currency_code = upper(currency_code)),
  entry_type text NOT NULL CHECK (entry_type IN ('SALE_POST', 'SALE_REVERSE')),
  amount numeric(20,6) NOT NULL CHECK (amount <> 0),
  source_document_type text NOT NULL CHECK (char_length(btrim(source_document_type)) BETWEEN 1 AND 64),
  source_document_id uuid NOT NULL,
  source_document_number text NOT NULL CHECK (char_length(btrim(source_document_number)) BETWEEN 1 AND 160),
  source_revision bigint NOT NULL DEFAULT 1 CHECK (source_revision >= 1),
  document_status_after text NOT NULL CHECK (document_status_after IN ('open', 'reversed')),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT receivable_ledger_entries_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT receivable_ledger_entries_source_type_unique UNIQUE (
    installation_id, source_document_type, source_document_id, entry_type
  ),
  CONSTRAINT receivable_ledger_entries_document_fk
    FOREIGN KEY (installation_id, receivable_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_ledger_entries_customer_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS receivable_ledger_entries_customer_idx
  ON accounting.receivable_ledger_entries (
    installation_id, customer_id, currency_code, occurred_at, id
  );
CREATE INDEX IF NOT EXISTS receivable_ledger_entries_document_idx
  ON accounting.receivable_ledger_entries (
    installation_id, receivable_document_id, occurred_at, id
  );

CREATE TABLE IF NOT EXISTS accounting.customer_receivable_balances (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  customer_id uuid NOT NULL,
  currency_code text NOT NULL CHECK (char_length(currency_code) = 3 AND currency_code = upper(currency_code)),
  balance numeric(20,6) NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, customer_id, currency_code),
  CONSTRAINT customer_receivable_balances_customer_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION accounting.guard_receivable_document_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'receivable_service' THEN
    RAISE EXCEPTION 'receivable_document_write_requires_service_context';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receivable_documents_cannot_be_deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.installation_id IS DISTINCT FROM OLD.installation_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.customer_address_id IS DISTINCT FROM OLD.customer_address_id
       OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
       OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
       OR NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id
       OR NEW.delivery_order_id IS DISTINCT FROM OLD.delivery_order_id
       OR NEW.direction IS DISTINCT FROM OLD.direction
       OR NEW.document_type IS DISTINCT FROM OLD.document_type
       OR NEW.source_document_type IS DISTINCT FROM OLD.source_document_type
       OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
       OR NEW.source_document_number IS DISTINCT FROM OLD.source_document_number
       OR NEW.source_document_date IS DISTINCT FROM OLD.source_document_date
       OR NEW.customer_code_snapshot IS DISTINCT FROM OLD.customer_code_snapshot
       OR NEW.customer_name_snapshot IS DISTINCT FROM OLD.customer_name_snapshot
       OR NEW.warehouse_code_snapshot IS DISTINCT FROM OLD.warehouse_code_snapshot
       OR NEW.warehouse_name_snapshot IS DISTINCT FROM OLD.warehouse_name_snapshot
       OR NEW.collection_policy IS DISTINCT FROM OLD.collection_policy
       OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
       OR NEW.original_amount IS DISTINCT FROM OLD.original_amount
       OR NEW.source_revision IS DISTINCT FROM OLD.source_revision
       OR NEW.posting_origin IS DISTINCT FROM OLD.posting_origin
       OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'receivable_document_immutable_fields_changed';
    END IF;
    IF NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'receivable_document_revision_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS receivable_documents_write_guard ON accounting.receivable_documents;
CREATE TRIGGER receivable_documents_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON accounting.receivable_documents
FOR EACH ROW EXECUTE FUNCTION accounting.guard_receivable_document_write();

CREATE OR REPLACE FUNCTION accounting.guard_receivable_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'receivable_service' THEN
    RAISE EXCEPTION 'receivable_history_write_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'receivable_history_is_append_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS receivable_document_lines_write_guard ON accounting.receivable_document_lines;
CREATE TRIGGER receivable_document_lines_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON accounting.receivable_document_lines
FOR EACH ROW EXECUTE FUNCTION accounting.guard_receivable_append_only();

DROP TRIGGER IF EXISTS receivable_ledger_entries_write_guard ON accounting.receivable_ledger_entries;
CREATE TRIGGER receivable_ledger_entries_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON accounting.receivable_ledger_entries
FOR EACH ROW EXECUTE FUNCTION accounting.guard_receivable_append_only();

CREATE OR REPLACE FUNCTION accounting.apply_customer_receivable_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO accounting.customer_receivable_balances (
    installation_id, customer_id, currency_code, balance, revision, updated_at
  ) VALUES (
    NEW.installation_id, NEW.customer_id, NEW.currency_code, NEW.amount, 1, NEW.occurred_at
  )
  ON CONFLICT (installation_id, customer_id, currency_code)
  DO UPDATE SET balance = accounting.customer_receivable_balances.balance + EXCLUDED.balance,
                revision = accounting.customer_receivable_balances.revision + 1,
                updated_at = GREATEST(accounting.customer_receivable_balances.updated_at, EXCLUDED.updated_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS receivable_ledger_entries_balance_apply ON accounting.receivable_ledger_entries;
CREATE TRIGGER receivable_ledger_entries_balance_apply
AFTER INSERT ON accounting.receivable_ledger_entries
FOR EACH ROW EXECUTE FUNCTION accounting.apply_customer_receivable_balance();

CREATE OR REPLACE FUNCTION accounting.rebuild_customer_receivable_balances()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  TRUNCATE TABLE accounting.customer_receivable_balances;
  INSERT INTO accounting.customer_receivable_balances (
    installation_id, customer_id, currency_code, balance, revision, updated_at
  )
  SELECT installation_id,
         customer_id,
         currency_code,
         sum(amount)::numeric(20,6),
         count(*)::bigint,
         max(occurred_at)
    FROM accounting.receivable_ledger_entries
   GROUP BY installation_id, customer_id, currency_code;
END;
$$;