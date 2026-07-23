-- Gate 7E follow-up: pack_unit/pack_quantity must not be inferred from BGKQ/source_key numbers.

create or replace function public.mcp_catalog_infer_pack_unit(p_text text, p_category text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_text, '') || ' ' || coalesce(p_category, ''));
  c text := lower(coalesce(p_category, ''));
begin
  if v like '%thùng%' or v like '%thung%' or v like '%carton%' then return 'thùng'; end if;
  if v like '%lốc%' or v like '%loc%' then return 'lốc'; end if;
  if v like '%bao%' then return 'bao'; end if;
  if v like '%bịch%' or v like '%bich%' or v like '%túi%' or v like '%tui%' then return 'bịch'; end if;
  if v like '%gói%' or v like '%goi%' then return 'gói'; end if;
  if v like '%hộp%' or v like '%hop%' then return 'hộp'; end if;
  if v like '%lon%' then return 'lon'; end if;
  if v like '%hũ%' or v like '%hủ%' or v ~ '(^|[^a-z])hu([^a-z]|$)' then return 'hũ'; end if;
  if v like '%bình%' or v like '%binh%' then return 'bình'; end if;
  if v like '%chai%' then return 'chai'; end if;

  if c like '%ống%' or c like '%ông hút%' or c like '%ong%' or c like '%hut%' or c like '%muỗng%' or c like '%muong%' or c like '%nắp%' or c like '%nap%' or c like '%bao ly%' then return 'bịch'; end if;
  if c like '%trái cây%' or c like '%trai cay%' or c like '%rau%' or c like '%flan%' or c like '%sữa đặc%' or c like '%sua dac%' then return 'hộp'; end if;
  if c like '%bột%' or c like '%bot%' or c like '%bôt%' or c like '%cacao%' or c like '%trân%' or c like '%tran%' or c like '%3q%' or c like '%thạch%' or c like '%thach%' then return 'bịch'; end if;
  if c like '%trà%' or c like '%tra%' or c like '%mỳ cay%' or c like '%mì cay%' or c like '%my cay%' or c like '%mi cay%' or c like '%đông lạnh%' or c like '%dong lanh%' then return 'gói'; end if;
  return null;
end;
$$;

create or replace function public.mcp_product_variant_normalize_before_write()
returns trigger
language plpgsql
as $$
declare
  p_name text;
  p_category text;
  p_source_key text;
  size_text text;
  pack_text text;
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

  size_text := coalesce(p_source_key, '') || ' ' || coalesce(p_name, '') || ' ' || coalesce(new.variant_name, '') || ' ' || coalesce(new.size_label, '');
  pack_text := coalesce(p_name, '') || ' ' || coalesce(new.variant_name, '') || ' ' || coalesce(p_category, '') || ' ' || coalesce(new.size_label, '');

  inferred_size := public.mcp_catalog_infer_size(size_text);
  new.size_label := nullif(coalesce(nullif(new.size_label, ''), inferred_size), '');

  normalized_sell_unit := public.mcp_catalog_normal_sell_unit(p_name, p_category, p_source_key, new.variant_name, new.size_label);
  new.sell_unit := coalesce(nullif(normalized_sell_unit, ''), 'cái');

  inferred_pack_unit := public.mcp_catalog_infer_pack_unit(pack_text, p_category);
  inferred_pack_quantity := public.mcp_catalog_infer_pack_quantity(pack_text);

  new.pack_unit := coalesce(inferred_pack_unit, case when new.sell_unit = 'thùng' then 'gói' else null end);
  new.pack_quantity := inferred_pack_quantity;
  new.raw_payload := coalesce(new.raw_payload, '{}'::jsonb) || jsonb_build_object('unit_normalization_version', '20260705_gate_7e_pack_fix', 'unit_normalized_at', now());
  new.updated_at := now();
  return new;
end;
$$;

update public.product_variants set updated_at = now();
