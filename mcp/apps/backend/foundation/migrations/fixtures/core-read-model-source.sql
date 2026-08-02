CREATE SCHEMA IF NOT EXISTS shared;
CREATE SCHEMA IF NOT EXISTS sales;

CREATE TABLE IF NOT EXISTS shared.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  customer_code text,
  legal_name text NOT NULL,
  trading_name text,
  tax_code text,
  phone text,
  email text,
  address text,
  status text NOT NULL DEFAULT 'active',
  credit_limit numeric NOT NULL DEFAULT 0,
  payment_term_days integer NOT NULL DEFAULT 0,
  sales_owner text,
  sales_region text,
  price_list_id uuid,
  notes text,
  source_candidate_id uuid,
  activated_at timestamptz,
  activated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  product_code text NOT NULL,
  name text NOT NULL,
  description text,
  category text,
  brand text,
  base_uom text,
  purchase_uom text,
  sales_uom text,
  tax_rate numeric NOT NULL DEFAULT 0,
  track_lot boolean NOT NULL DEFAULT false,
  track_expiry boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  is_stock_item boolean NOT NULL DEFAULT true,
  is_service_item boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  product_id uuid NOT NULL REFERENCES shared.products(id) ON DELETE CASCADE,
  sku text NOT NULL,
  variant_name text,
  size_label text,
  sell_unit text,
  pack_unit text,
  pack_quantity numeric,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  document_number text NOT NULL,
  customer_id uuid REFERENCES shared.customers(id) ON DELETE RESTRICT,
  order_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'draft',
  currency text NOT NULL DEFAULT 'VND',
  subtotal numeric NOT NULL DEFAULT 0,
  discount_total numeric NOT NULL DEFAULT 0,
  tax_total numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  approved_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales.order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES sales.orders(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  product_id uuid REFERENCES shared.products(id) ON DELETE RESTRICT,
  product_code text,
  description text,
  ordered_qty numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  discount_rate numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  tax_rate numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  line_subtotal numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
