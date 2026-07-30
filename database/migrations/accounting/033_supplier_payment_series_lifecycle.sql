-- Phase 5.6 hardening: create the default supplier-payment series when an
-- installation receives its first supplier after migrations have already run.

CREATE OR REPLACE FUNCTION accounting.ensure_supplier_payment_series_for_installation(
  p_installation_id text
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO shared.document_number_series (
    id,installation_id,code,document_type,name,prefix,number_template,reset_policy,
    sequence_width,start_counter,timezone_name,description,is_active,
    created_at,updated_at,created_by,updated_by
  ) VALUES (
    accounting.stable_uuid(p_installation_id || ':document-series:SUPPLIER_PAYMENT'),
    p_installation_id,'SUPPLIER_PAYMENT','SUPPLIER_PAYMENT',
    'Phiếu thanh toán nhà cung cấp','SP-','{PREFIX}{YYYY}{MM}-{SEQ}','MONTHLY',
    6,1,'Asia/Ho_Chi_Minh','Series mặc định cho thanh toán nhà cung cấp.',true,
    now(),now(),'system:supplier-payment-series','system:supplier-payment-series'
  )
  ON CONFLICT (installation_id,code) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.ensure_supplier_payment_series_after_supplier_insert()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM accounting.ensure_supplier_payment_series_for_installation(NEW.installation_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suppliers_ensure_supplier_payment_series ON shared.suppliers;
CREATE TRIGGER suppliers_ensure_supplier_payment_series
AFTER INSERT ON shared.suppliers
FOR EACH ROW EXECUTE FUNCTION accounting.ensure_supplier_payment_series_after_supplier_insert();

DO $$
DECLARE
  installation record;
BEGIN
  FOR installation IN SELECT DISTINCT installation_id FROM shared.suppliers LOOP
    PERFORM accounting.ensure_supplier_payment_series_for_installation(installation.installation_id);
  END LOOP;
END;
$$;
