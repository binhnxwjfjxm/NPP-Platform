-- Phase 5.5: immutable supplier payable posting foundation.
-- Payments and allocations are intentionally deferred to Phase 5.6.

CREATE SCHEMA IF NOT EXISTS accounting;

INSERT INTO shared.permission_catalog (permission_key,module,label,description,is_system,created_at)
VALUES ('core.payable.read','Công nợ phải trả','Xem công nợ phải trả','Cho phép đọc chứng từ, sổ chi tiết và số dư công nợ nhà cung cấp trong phạm vi kho được cấp.',true,now())
ON CONFLICT (permission_key) DO UPDATE
SET module=EXCLUDED.module,label=EXCLUDED.label,description=EXCLUDED.description,is_system=EXCLUDED.is_system;

CREATE OR REPLACE FUNCTION accounting.stable_uuid(value text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (substr(md5(value),1,8)||'-'||substr(md5(value),9,4)||'-4'||substr(md5(value),14,3)||'-8'||substr(md5(value),18,3)||'-'||substr(md5(value),21,12))::uuid;
$$;

CREATE TABLE IF NOT EXISTS accounting.payable_documents (
  id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  supplier_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  document_type text NOT NULL CHECK (document_type IN ('GOODS_RECEIPT','SUPPLIER_RETURN_CREDIT')),
  source_domain text NOT NULL DEFAULT 'PURCHASING' CHECK (source_domain='PURCHASING'),
  source_document_type text NOT NULL CHECK (source_document_type IN ('GOODS_RECEIPT','SUPPLIER_RETURN')),
  source_document_id uuid NOT NULL,
  source_document_number text NOT NULL CHECK (char_length(btrim(source_document_number)) BETWEEN 1 AND 160),
  source_document_date date NOT NULL,
  currency_code text NOT NULL CHECK (currency_code=upper(currency_code) AND char_length(currency_code)=3),
  payment_method_snapshot text NOT NULL CHECK (char_length(btrim(payment_method_snapshot)) BETWEEN 1 AND 64),
  payment_term_days_snapshot integer NOT NULL DEFAULT 0 CHECK (payment_term_days_snapshot BETWEEN 0 AND 3650),
  due_date date NOT NULL,
  original_amount numeric(20,6) NOT NULL CHECK (original_amount>0),
  allocated_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (allocated_amount>=0),
  remaining_amount numeric(20,6) NOT NULL CHECK (remaining_amount>=0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_allocated','settled','reversed')),
  source_revision bigint NOT NULL CHECK (source_revision>=1),
  posting_origin text NOT NULL DEFAULT 'runtime' CHECK (posting_origin IN ('runtime','migration_backfill')),
  posted_at timestamptz NOT NULL,
  posted_by text NOT NULL CHECK (char_length(posted_by) BETWEEN 1 AND 128),
  reversed_at timestamptz,
  reversed_by text CHECK (reversed_by IS NULL OR char_length(reversed_by) BETWEEN 1 AND 128),
  reversal_reason text CHECK (reversal_reason IS NULL OR char_length(btrim(reversal_reason)) BETWEEN 1 AND 2000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision>=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  UNIQUE (installation_id,id),
  UNIQUE (installation_id,source_document_type,source_document_id),
  FOREIGN KEY (installation_id,supplier_id) REFERENCES shared.suppliers(installation_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (installation_id,warehouse_id) REFERENCES shared.warehouses(installation_id,id) ON DELETE RESTRICT,
  CHECK (allocated_amount<=original_amount),
  CHECK ((status='reversed' AND remaining_amount=0 AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL)
      OR (status<>'reversed' AND remaining_amount=original_amount-allocated_amount AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)),
  CHECK (status<>'open' OR (allocated_amount=0 AND remaining_amount=original_amount)),
  CHECK (status<>'partially_allocated' OR (allocated_amount>0 AND allocated_amount<original_amount AND remaining_amount>0)),
  CHECK (status<>'settled' OR (allocated_amount=original_amount AND remaining_amount=0))
);
CREATE INDEX IF NOT EXISTS payable_documents_supplier_due_idx ON accounting.payable_documents(installation_id,supplier_id,status,due_date);
CREATE INDEX IF NOT EXISTS payable_documents_warehouse_date_idx ON accounting.payable_documents(installation_id,warehouse_id,source_document_date DESC,created_at DESC);

CREATE TABLE IF NOT EXISTS accounting.payable_document_lines (
  id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  payable_document_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 10000),
  source_goods_receipt_line_id uuid NOT NULL,
  source_supplier_return_line_id uuid,
  source_purchase_order_line_id uuid NOT NULL,
  sku_snapshot text NOT NULL CHECK (char_length(btrim(sku_snapshot)) BETWEEN 1 AND 96),
  item_name_snapshot text NOT NULL CHECK (char_length(btrim(item_name_snapshot)) BETWEEN 1 AND 256),
  unit_code_snapshot text NOT NULL CHECK (char_length(btrim(unit_code_snapshot)) BETWEEN 1 AND 32),
  quantity numeric(20,6) NOT NULL CHECK (quantity>0),
  unit_price numeric(20,6) NOT NULL CHECK (unit_price>=0),
  gross_amount numeric(20,6) NOT NULL CHECK (gross_amount>=0),
  discount_amount numeric(20,6) NOT NULL CHECK (discount_amount>=0),
  tax_amount numeric(20,6) NOT NULL CHECK (tax_amount>=0),
  line_amount numeric(20,6) NOT NULL CHECK (line_amount>=0 AND line_amount=gross_amount-discount_amount+tax_amount),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  UNIQUE (installation_id,id),
  UNIQUE (installation_id,payable_document_id,line_number),
  FOREIGN KEY (installation_id,payable_document_id) REFERENCES accounting.payable_documents(installation_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (installation_id,source_goods_receipt_line_id) REFERENCES purchasing.goods_receipt_lines(installation_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (installation_id,source_supplier_return_line_id) REFERENCES purchasing.supplier_return_lines(installation_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (installation_id,source_purchase_order_line_id) REFERENCES purchasing.purchase_order_lines(installation_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS payable_lines_receipt_idx ON accounting.payable_document_lines(installation_id,source_goods_receipt_line_id);

CREATE TABLE IF NOT EXISTS accounting.payable_ledger_entries (
  id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  payable_document_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  currency_code text NOT NULL CHECK (currency_code=upper(currency_code) AND char_length(currency_code)=3),
  entry_type text NOT NULL CHECK (entry_type IN ('GOODS_RECEIPT_POST','GOODS_RECEIPT_REVERSE','SUPPLIER_RETURN_POST','SUPPLIER_RETURN_REVERSE')),
  amount numeric(20,6) NOT NULL CHECK (amount<>0),
  source_document_type text NOT NULL CHECK (source_document_type IN ('GOODS_RECEIPT','SUPPLIER_RETURN')),
  source_document_id uuid NOT NULL,
  source_document_number text NOT NULL CHECK (char_length(btrim(source_document_number)) BETWEEN 1 AND 160),
  source_revision bigint NOT NULL CHECK (source_revision>=1),
  document_status_after text NOT NULL CHECK (document_status_after IN ('open','reversed')),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  UNIQUE (installation_id,id),
  UNIQUE (installation_id,source_document_type,source_document_id,entry_type),
  FOREIGN KEY (installation_id,payable_document_id) REFERENCES accounting.payable_documents(installation_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (installation_id,supplier_id) REFERENCES shared.suppliers(installation_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS payable_ledger_supplier_idx ON accounting.payable_ledger_entries(installation_id,supplier_id,currency_code,occurred_at,id);

CREATE TABLE IF NOT EXISTS accounting.supplier_payable_balances (
  installation_id text NOT NULL,
  supplier_id uuid NOT NULL,
  currency_code text NOT NULL CHECK (currency_code=upper(currency_code) AND char_length(currency_code)=3),
  balance numeric(20,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id,supplier_id,currency_code),
  FOREIGN KEY (installation_id,supplier_id) REFERENCES shared.suppliers(installation_id,id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION accounting.reject_payable_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'payable_history_is_append_only'; END; $$;
DROP TRIGGER IF EXISTS payable_lines_append_only ON accounting.payable_document_lines;
CREATE TRIGGER payable_lines_append_only BEFORE UPDATE OR DELETE ON accounting.payable_document_lines FOR EACH ROW EXECUTE FUNCTION accounting.reject_payable_history_mutation();
DROP TRIGGER IF EXISTS payable_ledger_append_only ON accounting.payable_ledger_entries;
CREATE TRIGGER payable_ledger_append_only BEFORE UPDATE OR DELETE ON accounting.payable_ledger_entries FOR EACH ROW EXECUTE FUNCTION accounting.reject_payable_history_mutation();

CREATE OR REPLACE FUNCTION accounting.guard_payable_document_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payable_documents_are_immutable'; END IF;
  IF NEW.installation_id IS DISTINCT FROM OLD.installation_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.document_type IS DISTINCT FROM OLD.document_type OR NEW.source_domain IS DISTINCT FROM OLD.source_domain
     OR NEW.source_document_type IS DISTINCT FROM OLD.source_document_type OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
     OR NEW.source_document_number IS DISTINCT FROM OLD.source_document_number OR NEW.source_document_date IS DISTINCT FROM OLD.source_document_date
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.payment_method_snapshot IS DISTINCT FROM OLD.payment_method_snapshot
     OR NEW.payment_term_days_snapshot IS DISTINCT FROM OLD.payment_term_days_snapshot OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.original_amount IS DISTINCT FROM OLD.original_amount OR NEW.posting_origin IS DISTINCT FROM OLD.posting_origin
     OR NEW.posted_at IS DISTINCT FROM OLD.posted_at OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
  THEN RAISE EXCEPTION 'payable_documents_are_immutable'; END IF;
  IF OLD.status='reversed' OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status<>'reversed') THEN
    RAISE EXCEPTION 'invalid_payable_status_transition';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS payable_documents_guard ON accounting.payable_documents;
CREATE TRIGGER payable_documents_guard BEFORE UPDATE OR DELETE ON accounting.payable_documents FOR EACH ROW EXECUTE FUNCTION accounting.guard_payable_document_mutation();

CREATE OR REPLACE FUNCTION accounting.project_supplier_payable_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO accounting.supplier_payable_balances(installation_id,supplier_id,currency_code,balance,updated_at)
  VALUES(NEW.installation_id,NEW.supplier_id,NEW.currency_code,NEW.amount,NEW.occurred_at)
  ON CONFLICT(installation_id,supplier_id,currency_code) DO UPDATE
  SET balance=accounting.supplier_payable_balances.balance+EXCLUDED.balance,
      updated_at=GREATEST(accounting.supplier_payable_balances.updated_at,EXCLUDED.updated_at);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS payable_ledger_project_balance ON accounting.payable_ledger_entries;
CREATE TRIGGER payable_ledger_project_balance AFTER INSERT ON accounting.payable_ledger_entries FOR EACH ROW EXECUTE FUNCTION accounting.project_supplier_payable_balance();

CREATE OR REPLACE FUNCTION accounting.rebuild_supplier_payable_balances() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE accounting.supplier_payable_balances;
  INSERT INTO accounting.supplier_payable_balances(installation_id,supplier_id,currency_code,balance,updated_at)
  SELECT installation_id,supplier_id,currency_code,sum(amount)::numeric(20,6),max(occurred_at)
  FROM accounting.payable_ledger_entries GROUP BY installation_id,supplier_id,currency_code;
END; $$;

WITH src AS (
 SELECT gr.installation_id,gr.id,gr.warehouse_id,po.supplier_id,gr.document_number,gr.receipt_date,po.currency_code,
        COALESCE(term.payment_method,'UNSPECIFIED') payment_method,COALESCE(term.term_days,0) term_days,
        gr.revision,gr.posted_at,gr.posted_by,gr.reversed_at,gr.reversed_by,gr.reversal_reason,gr.status,
        sum(round(grl.accepted_quantity*pol.unit_price,6)-round(pol.discount_amount*grl.accepted_quantity/pol.ordered_quantity,6)+round(pol.tax_amount*grl.accepted_quantity/pol.ordered_quantity,6))::numeric(20,6) amount
 FROM purchasing.goods_receipts gr
 JOIN purchasing.purchase_orders po ON po.installation_id=gr.installation_id AND po.id=gr.purchase_order_id
 JOIN purchasing.goods_receipt_lines grl ON grl.installation_id=gr.installation_id AND grl.goods_receipt_id=gr.id
 JOIN purchasing.purchase_order_lines pol ON pol.installation_id=grl.installation_id AND pol.id=grl.purchase_order_line_id
 LEFT JOIN LATERAL (SELECT payment_method,COALESCE(term_days,0) term_days FROM shared.supplier_payment_terms t WHERE t.installation_id=gr.installation_id AND t.supplier_id=po.supplier_id AND t.is_active=true AND t.is_primary=true ORDER BY t.created_at,t.id LIMIT 1) term ON true
 WHERE gr.status IN ('posted','reversed') AND gr.document_number IS NOT NULL AND grl.accepted_quantity>0
 GROUP BY gr.installation_id,gr.id,gr.warehouse_id,po.supplier_id,gr.document_number,gr.receipt_date,po.currency_code,term.payment_method,term.term_days,gr.revision,gr.posted_at,gr.posted_by,gr.reversed_at,gr.reversed_by,gr.reversal_reason,gr.status
)
INSERT INTO accounting.payable_documents(id,installation_id,supplier_id,warehouse_id,direction,document_type,source_document_type,source_document_id,source_document_number,source_document_date,currency_code,payment_method_snapshot,payment_term_days_snapshot,due_date,original_amount,allocated_amount,remaining_amount,status,source_revision,posting_origin,posted_at,posted_by,reversed_at,reversed_by,reversal_reason,revision,created_at,updated_at,created_by,updated_by)
SELECT accounting.stable_uuid(installation_id||':payable:GR:'||id::text),installation_id,supplier_id,warehouse_id,'DEBIT','GOODS_RECEIPT','GOODS_RECEIPT',id,document_number,receipt_date,currency_code,payment_method,term_days,receipt_date+term_days,amount,0,CASE WHEN status='reversed' THEN 0 ELSE amount END,CASE WHEN status='reversed' THEN 'reversed' ELSE 'open' END,revision,'migration_backfill',posted_at,posted_by,reversed_at,reversed_by,reversal_reason,CASE WHEN status='reversed' THEN 2 ELSE 1 END,posted_at,COALESCE(reversed_at,posted_at),posted_by,COALESCE(reversed_by,posted_by)
FROM src WHERE amount>0 ON CONFLICT(installation_id,source_document_type,source_document_id) DO NOTHING;

INSERT INTO accounting.payable_document_lines(id,installation_id,payable_document_id,line_number,source_goods_receipt_line_id,source_supplier_return_line_id,source_purchase_order_line_id,sku_snapshot,item_name_snapshot,unit_code_snapshot,quantity,unit_price,gross_amount,discount_amount,tax_amount,line_amount,created_at,created_by)
SELECT accounting.stable_uuid(grl.installation_id||':payable:GR:'||gr.id::text||':line:'||grl.id::text),grl.installation_id,pd.id,grl.line_number,grl.id,NULL,grl.purchase_order_line_id,grl.sku_snapshot,grl.item_name_snapshot,grl.unit_code_snapshot,grl.accepted_quantity,pol.unit_price,
       round(grl.accepted_quantity*pol.unit_price,6),round(pol.discount_amount*grl.accepted_quantity/pol.ordered_quantity,6),round(pol.tax_amount*grl.accepted_quantity/pol.ordered_quantity,6),
       round(grl.accepted_quantity*pol.unit_price,6)-round(pol.discount_amount*grl.accepted_quantity/pol.ordered_quantity,6)+round(pol.tax_amount*grl.accepted_quantity/pol.ordered_quantity,6),gr.posted_at,gr.posted_by
FROM purchasing.goods_receipts gr JOIN purchasing.goods_receipt_lines grl ON grl.installation_id=gr.installation_id AND grl.goods_receipt_id=gr.id
JOIN purchasing.purchase_order_lines pol ON pol.installation_id=grl.installation_id AND pol.id=grl.purchase_order_line_id
JOIN accounting.payable_documents pd ON pd.installation_id=gr.installation_id AND pd.source_document_type='GOODS_RECEIPT' AND pd.source_document_id=gr.id
WHERE gr.status IN ('posted','reversed') AND grl.accepted_quantity>0 ON CONFLICT(installation_id,payable_document_id,line_number) DO NOTHING;

WITH lines AS (
 SELECT sr.installation_id,sr.id,sr.supplier_id,sr.warehouse_id,sr.document_number,sr.return_date,sr.revision,sr.posted_at,sr.posted_by,sr.reversed_at,sr.reversed_by,sr.reversal_reason,sr.status,
        srl.id line_id,srl.line_number,srl.source_goods_receipt_line_id,srl.source_purchase_order_line_id,srl.source_sku_snapshot,srl.source_item_name_snapshot,srl.source_unit_code_snapshot,srl.return_quantity,
        debit.currency_code,debit_line.quantity source_quantity,debit_line.unit_price,
        round(debit_line.gross_amount*srl.return_quantity/debit_line.quantity,6)::numeric(20,6) gross,
        round(debit_line.discount_amount*srl.return_quantity/debit_line.quantity,6)::numeric(20,6) discount,
        round(debit_line.tax_amount*srl.return_quantity/debit_line.quantity,6)::numeric(20,6) tax
 FROM purchasing.supplier_returns sr JOIN purchasing.supplier_return_lines srl ON srl.installation_id=sr.installation_id AND srl.supplier_return_id=sr.id
 JOIN accounting.payable_document_lines debit_line ON debit_line.installation_id=srl.installation_id AND debit_line.source_goods_receipt_line_id=srl.source_goods_receipt_line_id AND debit_line.source_supplier_return_line_id IS NULL
 JOIN accounting.payable_documents debit ON debit.installation_id=debit_line.installation_id AND debit.id=debit_line.payable_document_id AND debit.direction='DEBIT'
 WHERE sr.status IN ('posted','reversed') AND sr.document_number IS NOT NULL
), docs AS (
 SELECT installation_id,id,supplier_id,warehouse_id,document_number,return_date,revision,posted_at,posted_by,reversed_at,reversed_by,reversal_reason,status,currency_code,sum(gross-discount+tax)::numeric(20,6) amount
 FROM lines GROUP BY installation_id,id,supplier_id,warehouse_id,document_number,return_date,revision,posted_at,posted_by,reversed_at,reversed_by,reversal_reason,status,currency_code
)
INSERT INTO accounting.payable_documents(id,installation_id,supplier_id,warehouse_id,direction,document_type,source_document_type,source_document_id,source_document_number,source_document_date,currency_code,payment_method_snapshot,payment_term_days_snapshot,due_date,original_amount,allocated_amount,remaining_amount,status,source_revision,posting_origin,posted_at,posted_by,reversed_at,reversed_by,reversal_reason,revision,created_at,updated_at,created_by,updated_by)
SELECT accounting.stable_uuid(installation_id||':payable:SR:'||id::text),installation_id,supplier_id,warehouse_id,'CREDIT','SUPPLIER_RETURN_CREDIT','SUPPLIER_RETURN',id,document_number,return_date,currency_code,'CREDIT_NOTE',0,return_date,amount,0,CASE WHEN status='reversed' THEN 0 ELSE amount END,CASE WHEN status='reversed' THEN 'reversed' ELSE 'open' END,revision,'migration_backfill',posted_at,posted_by,reversed_at,reversed_by,reversal_reason,CASE WHEN status='reversed' THEN 2 ELSE 1 END,posted_at,COALESCE(reversed_at,posted_at),posted_by,COALESCE(reversed_by,posted_by)
FROM docs WHERE amount>0 ON CONFLICT(installation_id,source_document_type,source_document_id) DO NOTHING;

WITH lines AS (
 SELECT sr.installation_id,sr.id,sr.posted_at,sr.posted_by,srl.id line_id,srl.line_number,srl.source_goods_receipt_line_id,srl.source_purchase_order_line_id,srl.source_sku_snapshot,srl.source_item_name_snapshot,srl.source_unit_code_snapshot,srl.return_quantity,debit_line.unit_price,
        round(debit_line.gross_amount*srl.return_quantity/debit_line.quantity,6)::numeric(20,6) gross,
        round(debit_line.discount_amount*srl.return_quantity/debit_line.quantity,6)::numeric(20,6) discount,
        round(debit_line.tax_amount*srl.return_quantity/debit_line.quantity,6)::numeric(20,6) tax
 FROM purchasing.supplier_returns sr JOIN purchasing.supplier_return_lines srl ON srl.installation_id=sr.installation_id AND srl.supplier_return_id=sr.id
 JOIN accounting.payable_document_lines debit_line ON debit_line.installation_id=srl.installation_id AND debit_line.source_goods_receipt_line_id=srl.source_goods_receipt_line_id AND debit_line.source_supplier_return_line_id IS NULL
 WHERE sr.status IN ('posted','reversed')
)
INSERT INTO accounting.payable_document_lines(id,installation_id,payable_document_id,line_number,source_goods_receipt_line_id,source_supplier_return_line_id,source_purchase_order_line_id,sku_snapshot,item_name_snapshot,unit_code_snapshot,quantity,unit_price,gross_amount,discount_amount,tax_amount,line_amount,created_at,created_by)
SELECT accounting.stable_uuid(lines.installation_id||':payable:SR:'||lines.id::text||':line:'||lines.line_id::text),lines.installation_id,pd.id,lines.line_number,lines.source_goods_receipt_line_id,lines.line_id,lines.source_purchase_order_line_id,lines.source_sku_snapshot,lines.source_item_name_snapshot,lines.source_unit_code_snapshot,lines.return_quantity,lines.unit_price,lines.gross,lines.discount,lines.tax,lines.gross-lines.discount+lines.tax,lines.posted_at,lines.posted_by
FROM lines JOIN accounting.payable_documents pd ON pd.installation_id=lines.installation_id AND pd.source_document_type='SUPPLIER_RETURN' AND pd.source_document_id=lines.id
ON CONFLICT(installation_id,payable_document_id,line_number) DO NOTHING;

INSERT INTO accounting.payable_ledger_entries(id,installation_id,payable_document_id,supplier_id,currency_code,entry_type,amount,source_document_type,source_document_id,source_document_number,source_revision,document_status_after,actor_id,request_id,source_app,occurred_at,metadata)
SELECT accounting.stable_uuid(pd.installation_id||':payable-ledger:'||pd.id::text||':post'),pd.installation_id,pd.id,pd.supplier_id,pd.currency_code,
       CASE WHEN pd.direction='DEBIT' THEN 'GOODS_RECEIPT_POST' ELSE 'SUPPLIER_RETURN_POST' END,
       CASE WHEN pd.direction='DEBIT' THEN pd.original_amount ELSE -pd.original_amount END,pd.source_document_type,pd.source_document_id,pd.source_document_number,pd.source_revision,'open',pd.posted_by,'migration:payable:'||pd.source_document_id::text,'migration',pd.posted_at,jsonb_build_object('postingOrigin','migration_backfill')
FROM accounting.payable_documents pd
ON CONFLICT(installation_id,source_document_type,source_document_id,entry_type) DO NOTHING;

INSERT INTO accounting.payable_ledger_entries(id,installation_id,payable_document_id,supplier_id,currency_code,entry_type,amount,source_document_type,source_document_id,source_document_number,source_revision,document_status_after,actor_id,request_id,source_app,occurred_at,metadata)
SELECT accounting.stable_uuid(pd.installation_id||':payable-ledger:'||pd.id::text||':reverse'),pd.installation_id,pd.id,pd.supplier_id,pd.currency_code,
       CASE WHEN pd.direction='DEBIT' THEN 'GOODS_RECEIPT_REVERSE' ELSE 'SUPPLIER_RETURN_REVERSE' END,
       CASE WHEN pd.direction='DEBIT' THEN -pd.original_amount ELSE pd.original_amount END,pd.source_document_type,pd.source_document_id,pd.source_document_number,pd.source_revision,'reversed',pd.reversed_by,'migration:payable-reversal:'||pd.source_document_id::text,'migration',pd.reversed_at,jsonb_build_object('postingOrigin','migration_backfill','reason',pd.reversal_reason)
FROM accounting.payable_documents pd WHERE pd.status='reversed'
ON CONFLICT(installation_id,source_document_type,source_document_id,entry_type) DO NOTHING;

SELECT accounting.rebuild_supplier_payable_balances();
