-- Gate 7A: product catalog master + unit normalization foundation.
-- This migration only creates the catalog DB layer. UI product selector stays for the next gate.

create table if not exists public.product_categories (
  industry_code text primary key,
  name text not null,
  status text not null default 'active' check (status in ('active','hidden','archived')),
  sort_order integer not null default 0,
  note text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_industry_code_not_blank check (btrim(industry_code) <> '')
);

create table if not exists public.product_brands (
  brand_code text primary key,
  brand_name text not null,
  status text not null default 'active' check (status in ('active','hidden','archived')),
  sort_order integer not null default 0,
  note text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_brands_brand_code_not_blank check (btrim(brand_code) <> '')
);

create table if not exists public.products (
  id text primary key,
  industry_code text not null references public.product_categories(industry_code) on update cascade,
  brand_code text not null references public.product_brands(brand_code) on update cascade,
  name text not null,
  category text not null,
  brand_name text,
  status text not null default 'active' check (status in ('active','hidden','archived')),
  source_key text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_id_not_blank check (btrim(id) <> ''),
  constraint products_name_not_blank check (btrim(name) <> ''),
  constraint products_category_not_blank check (btrim(category) <> '')
);

create table if not exists public.product_variants (
  id text primary key,
  product_id text not null references public.products(id) on delete cascade on update cascade,
  sku text,
  variant_name text not null,
  size_label text,
  sell_unit text not null,
  pack_unit text,
  pack_quantity numeric,
  base_price numeric not null default 0 check (base_price >= 0),
  status text not null default 'active' check (status in ('active','hidden','archived')),
  raw_options jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_id_not_blank check (btrim(id) <> ''),
  constraint product_variants_name_not_blank check (btrim(variant_name) <> ''),
  constraint product_variants_sell_unit_not_blank check (btrim(sell_unit) <> ''),
  constraint product_variants_pack_quantity_positive check (pack_quantity is null or pack_quantity > 0)
);

create table if not exists public.product_unit_rules (
  id text primary key default ('pur_' || replace(gen_random_uuid()::text, '-', '')),
  industry_code text references public.product_categories(industry_code) on update cascade,
  category_pattern text,
  name_pattern text,
  default_sell_unit text not null,
  default_pack_unit text,
  default_pack_quantity numeric,
  priority integer not null default 100,
  status text not null default 'active' check (status in ('active','hidden','archived')),
  note text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_unit_rules_sell_unit_not_blank check (btrim(default_sell_unit) <> ''),
  constraint product_unit_rules_pack_quantity_positive check (default_pack_quantity is null or default_pack_quantity > 0)
);

alter table public.order_items
  add column if not exists variant_id text references public.product_variants(id) on delete set null on update cascade;

create index if not exists idx_products_lookup on public.products(status, industry_code, brand_code, category);
create index if not exists idx_products_name_trgm_fallback on public.products(lower(name));
create index if not exists idx_product_variants_product_status on public.product_variants(product_id, status);
create index if not exists idx_product_variants_sku on public.product_variants(sku) where sku is not null;
create index if not exists idx_product_unit_rules_lookup on public.product_unit_rules(status, industry_code, priority);
create index if not exists idx_order_items_variant_id on public.order_items(variant_id) where variant_id is not null;

alter table public.product_categories enable row level security;
alter table public.product_brands enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_unit_rules enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_categories' and policyname = 'product_categories_read_active') then
    create policy product_categories_read_active on public.product_categories
      for select to anon, authenticated
      using (status = 'active');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_brands' and policyname = 'product_brands_read_active') then
    create policy product_brands_read_active on public.product_brands
      for select to anon, authenticated
      using (status = 'active');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'products' and policyname = 'products_read_active') then
    create policy products_read_active on public.products
      for select to anon, authenticated
      using (status = 'active');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_variants' and policyname = 'product_variants_read_active') then
    create policy product_variants_read_active on public.product_variants
      for select to anon, authenticated
      using (status = 'active');
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_unit_rules' and policyname = 'product_unit_rules_read_active') then
    create policy product_unit_rules_read_active on public.product_unit_rules
      for select to anon, authenticated
      using (status = 'active');
  end if;
end $$;

grant select on public.product_categories to anon, authenticated;
grant select on public.product_brands to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.product_variants to anon, authenticated;
grant select on public.product_unit_rules to anon, authenticated;
grant all on public.product_categories to service_role;
grant all on public.product_brands to service_role;
grant all on public.products to service_role;
grant all on public.product_variants to service_role;
grant all on public.product_unit_rules to service_role;

insert into public.product_categories (industry_code, name, sort_order, note, raw_payload)
values
  ('T', 'Trà sữa / nguyên liệu pha chế', 10, 'Ngành chính cho nguyên liệu pha chế, syrup, topping, trà, bột.', '{"seed":"gate_7a"}'::jsonb),
  ('M', 'Mì cay', 20, 'Mì cay và nhóm nguyên liệu liên quan.', '{"seed":"gate_7a"}'::jsonb),
  ('F', 'Thực phẩm đông lạnh', 30, 'Nhóm hàng đông lạnh.', '{"seed":"gate_7a"}'::jsonb),
  ('P', 'Bao bì / ly / nắp / ống hút', 40, 'Packaging phục vụ quán.', '{"seed":"gate_7a"}'::jsonb),
  ('D', 'Đồ lẻ / phụ trợ', 50, 'Nhóm phụ trợ chưa xếp ngành rõ.', '{"seed":"gate_7a"}'::jsonb)
on conflict (industry_code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  note = excluded.note,
  updated_at = now();

insert into public.product_brands (brand_code, brand_name, sort_order, note, raw_payload)
values
  ('MA', 'Mama', 10, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb),
  ('GO', 'Golden Farm / Gold', 20, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb),
  ('TO', 'Torani', 30, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb),
  ('VI', 'Vina', 40, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb),
  ('GT', 'GTP', 50, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb),
  ('DO', 'Douxian', 60, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb),
  ('BE', 'Berrino', 70, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb),
  ('KI', 'King', 80, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb),
  ('OK', 'OK', 90, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb),
  ('NO', 'No brand / chưa rõ', 900, 'Fallback khi chưa xác định thương hiệu.', '{"seed":"gate_7a"}'::jsonb),
  ('LA', 'Larose', 100, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb),
  ('KO', 'Koreno', 110, 'Brand code seed Gate 7A.', '{"seed":"gate_7a"}'::jsonb)
on conflict (brand_code) do update set
  brand_name = excluded.brand_name,
  sort_order = excluded.sort_order,
  note = excluded.note,
  updated_at = now();

insert into public.product_unit_rules (id, industry_code, category_pattern, name_pattern, default_sell_unit, default_pack_unit, default_pack_quantity, priority, note, raw_payload)
values
  ('pur_t_liquid_bottle', 'T', 'Siro|Sinh tố|Đường đen|Sốt topping', 'siro|sinh tố|đường đen|sốt|sauce|syrup', 'chai', 'thùng', 12, 10, 'Hàng lỏng thường bán theo chai/bình, đóng thùng.', '{"seed":"gate_7a"}'::jsonb),
  ('pur_t_powder_pack', 'T', 'Bột sữa|Bột cacao|Matcha|Frappe', 'bột|powder|cacao|matcha|frappe', 'gói', null, null, 20, 'Bột pha chế ưu tiên gói/bao theo quy cách.', '{"seed":"gate_7a"}'::jsonb),
  ('pur_t_tea_pack', 'T', 'Trà các loại', 'trà|tea|oolong|lài|đen|xanh', 'gói', null, null, 30, 'Trà thường bán theo gói 500g/1kg.', '{"seed":"gate_7a"}'::jsonb),
  ('pur_t_topping_bag', 'T', 'Trân châu|3Q|Rau câu|Topping', 'trân châu|3q|thạch|rau câu|topping|pudding|flan', 'bịch', null, null, 40, 'Topping túi ưu tiên bịch/gói.', '{"seed":"gate_7a"}'::jsonb),
  ('pur_t_can_box', 'T', 'Trái cây hộp|Sữa đặc', 'hộp|lon|sữa đặc|trái cây hộp', 'hộp', null, null, 50, 'Lon/hộp giữ đơn vị hộp.', '{"seed":"gate_7a"}'::jsonb),
  ('pur_p_packaging_bag', 'P', 'Ống hút|Muỗng|Nắp|Bao ly|Ly', 'ống hút|muỗng|nắp|bao ly|ly nhựa|cup', 'bịch', null, null, 10, 'Packaging thường bán theo bịch/cây/thùng tùy quy cách.', '{"seed":"gate_7a"}'::jsonb),
  ('pur_m_noodle_carton', 'M', 'Mì cay|Nguyên liệu mì cay', 'mì|koreno|gói', 'thùng', 'gói', 100, 10, 'Mì cay mặc định thùng, inner unit gói.', '{"seed":"gate_7a"}'::jsonb),
  ('pur_f_frozen_pack', 'F', 'Thực phẩm đông lạnh', 'đông lạnh|viên|xúc xích|cá|bò|gà', 'gói', null, null, 10, 'Đông lạnh ưu tiên gói hoặc kg theo tên hàng.', '{"seed":"gate_7a"}'::jsonb),
  ('pur_d_default_piece', 'D', 'Đồ lẻ|Phụ trợ', 'đồ lẻ|phụ trợ', 'cái', null, null, 900, 'Fallback cho đồ lẻ chưa rõ quy cách.', '{"seed":"gate_7a"}'::jsonb)
on conflict (id) do update set
  industry_code = excluded.industry_code,
  category_pattern = excluded.category_pattern,
  name_pattern = excluded.name_pattern,
  default_sell_unit = excluded.default_sell_unit,
  default_pack_unit = excluded.default_pack_unit,
  default_pack_quantity = excluded.default_pack_quantity,
  priority = excluded.priority,
  note = excluded.note,
  updated_at = now();
