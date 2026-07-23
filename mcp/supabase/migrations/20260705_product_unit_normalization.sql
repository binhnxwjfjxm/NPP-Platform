-- Gate 7E: normalize product units at DB layer.
-- API search and popup order consume these fields directly from product_variants.

create or replace function public.mcp_catalog_infer_size(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_text, ''));
  m text[];
begin
  if v like '%2-5kg%' or v like '%2.5kg%' or v like '%2,5kg%' then return '2,5 kg'; end if;

  m := regexp_match(v, '([0-9]+([\.,][0-9]+)?)\s*(kg|kilo)');
  if m is not null then return replace(m[1], '.', ',') || ' kg'; end if;

  m := regexp_match(v, '([0-9]+([\.,][0-9]+)?)\s*(gram|gr|g)([^a-z]|$)');
  if m is not null then return replace(m[1], '.', ',') || ' g'; end if;

  m := regexp_match(v, '([0-9]+([\.,][0-9]+)?)\s*ml([^a-z]|$)');
  if m is not null then return replace(m[1], '.', ',') || ' ml'; end if;

  m := regexp_match(v, '([0-9]+([\.,][0-9]+)?)\s*(lit|l)([^a-z]|$)');
  if m is not null then return replace(m[1], '.', ',') || ' L'; end if;

  return '';
end;
$$;

create or replace function public.mcp_catalog_infer_pack_unit(p_text text, p_category text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_text, '') || ' ' || coalesce(p_category, ''));
begin
  if v like '%thùng%' or v like '%thung%' or v like '%carton%' then return 'thùng'; end if;
  if v like '%lốc%' or v like '%loc%' then return 'lốc'; end if;
  if v like '%bao%' then return 'bao'; end if;
  if v like '%bịch%' or v like '%bich%' or v like '%túi%' or v like '%tui%' then return 'bịch'; end if;
  if v like '%gói%' or v like '%goi%' then return 'gói'; end if;
  if v like '%hộp%' or v like '%hop%' then return 'hộp'; end if;
  if v like '%lon%' then return 'lon'; end if;
  if v like '%hũ%' or v like '%hu%' then return 'hũ'; end if;
  if v like '%bình%' or v like '%binh%' then return 'bình'; end if;
  if v like '%chai%' then return 'chai'; end if;
  return null;
end;
$$;

create or replace function public.mcp_catalog_infer_pack_quantity(p_text text)
returns numeric
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_text, ''));
  m text[];
begin
  m := regexp_match(v, '([0-9]+)\s*(cái|cai|gói|goi|chai|ly|ống|ong|nắp|nap|bịch|bich|hộp|hop|lon)');
  if m is not null then return m[1]::numeric; end if;
  return null;
end;
$$;

create or replace function public.mcp_catalog_normal_sell_unit(p_name text, p_category text, p_source_key text, p_variant_name text, p_size text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_source_key, '') || ' ' || coalesce(p_name, '') || ' ' || coalesce(p_variant_name, '') || ' ' || coalesce(p_category, '') || ' ' || coalesce(p_size, ''));
  c text := lower(coalesce(p_category, ''));
begin
  -- Explicit packaging words win first.
  if v like '%thùng%' or v like '%thung%' or v like '%carton%' then return 'thùng'; end if;
  if v like '%lon%' then return 'lon'; end if;
  if v like '%hộp%' or v like '%hop%' then return 'hộp'; end if;
  if v like '%hũ%' or v like '%hu%' then return 'hũ'; end if;
  if v like '%bao%' then return 'bao'; end if;
  if v like '%bịch%' or v like '%bich%' or v like '%túi%' or v like '%tui%' then return 'bịch'; end if;
  if v like '%gói%' or v like '%goi%' then return 'gói'; end if;
  if v like '%bình%' or v like '%binh%' then return 'bình'; end if;
  if v like '%chai%' then return 'chai'; end if;

  -- Category defaults, only after explicit words.
  if c like '%siro%' then
    if v like '%2l%' or v like '%2 l%' or v like '%2 lit%' or v like '%2,5 kg%' or v like '%2.5 kg%' then return 'bình'; end if;
    return 'chai';
  end if;

  if c like '%sinh%' or c like '%topping%' then return 'chai'; end if;

  if c like '%đường%' or c like '%duong%' then
    if v like '%1l%' or v like '%1 l%' or v like '%2l%' or v like '%2 l%' or v like '%nước%' or v like '%nuoc%' then return 'chai'; end if;
    return 'bịch';
  end if;

  if c like '%trân%' or c like '%tran%' then return 'bịch'; end if;
  if c like '%3q%' or c like '%thạch%' or c like '%thach%' then return 'bịch'; end if;
  if c like '%trái cây%' or c like '%trai cay%' then return 'hộp'; end if;
  if c like '%rau%' or c like '%flan%' then return 'hộp'; end if;
  if c like '%sữa đặc%' or c like '%sua dac%' then return 'hộp'; end if;
  if c like '%bột%' or c like '%bot%' or c like '%cacao%' then return 'bịch'; end if;
  if c like '%trà%' or c like '%tra%' then return 'gói'; end if;
  if c like '%ống%' or c like '%ong%' or c like '%muỗng%' or c like '%muong%' or c like '%nắp%' or c like '%nap%' or c like '%bao ly%' then return 'bịch'; end if;

  if c like '%mỳ cay%' or c like '%mì cay%' or c like '%my cay%' or c like '%mi cay%' then
    if v like '%koreno%' or v like '%mì%' or v like '% mi %' then return 'thùng'; end if;
    return 'gói';
  end if;

  if c like '%đông lạnh%' or c like '%dong lanh%' or c like '%thực phẩm đông lạnh%' or c like '%thuc pham dong lanh%' then return 'gói'; end if;
  return 'cái';
end;
$$;

create or replace function public.mcp_bepsi_size(p_product_key text, p_name text)
returns text
language sql
immutable
as $$
  select public.mcp_catalog_infer_size(coalesce(p_product_key, '') || ' ' || coalesce(p_name, ''));
$$;

create or replace function public.mcp_bepsi_unit(p_product_key text, p_name text, p_category text, p_size text)
returns text
language sql
immutable
as $$
  select public.mcp_catalog_normal_sell_unit(p_name, p_category, p_product_key, '', p_size);
$$;

create or replace function public.mcp_product_variant_normalize_before_write()
returns trigger
language plpgsql
as $$
declare
  p_name text;
  p_category text;
  p_source_key text;
  source_text text;
  inferred_size text;
  inferred_pack_unit text;
  inferred_pack_quantity numeric;
  normalized_sell_unit text;
begin
  if coalesce(new.raw_payload ->> 'unit_manual', '') = 'true' then
    return new;
  end if;

  select name, category, source_key into p_name, p_category, p_source_key
    from public.products
   where id = new.product_id;

  source_text := coalesce(p_source_key, '') || ' ' || coalesce(p_name, '') || ' ' || coalesce(new.variant_name, '') || ' ' || coalesce(new.size_label, '');
  inferred_size := public.mcp_catalog_infer_size(source_text);
  new.size_label := nullif(coalesce(nullif(new.size_label, ''), inferred_size), '');

  normalized_sell_unit := public.mcp_catalog_normal_sell_unit(p_name, p_category, p_source_key, new.variant_name, new.size_label);
  new.sell_unit := coalesce(nullif(normalized_sell_unit, ''), nullif(new.sell_unit, ''), 'cái');

  inferred_pack_unit := public.mcp_catalog_infer_pack_unit(source_text, p_category);
  inferred_pack_quantity := public.mcp_catalog_infer_pack_quantity(source_text);

  new.pack_unit := coalesce(inferred_pack_unit, new.pack_unit, case when new.sell_unit = 'thùng' then 'gói' else null end);
  new.pack_quantity := coalesce(new.pack_quantity, inferred_pack_quantity);
  new.raw_payload := coalesce(new.raw_payload, '{}'::jsonb) || jsonb_build_object('unit_normalization_version', '20260705_gate_7e', 'unit_normalized_at', now());
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_mcp_product_variant_normalize_before_write on public.product_variants;
create trigger trg_mcp_product_variant_normalize_before_write
before insert or update on public.product_variants
for each row execute function public.mcp_product_variant_normalize_before_write();

update public.product_variants set updated_at = now();
