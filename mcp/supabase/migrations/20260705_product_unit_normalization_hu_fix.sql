-- Gate 7E follow-up: avoid treating words like ong-hut / hung as hũ.

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
  if v like '%hũ%' or v like '%hủ%' or v ~ '(^|[^a-z])hu([^a-z]|$)' then return 'hũ'; end if;
  if v like '%bình%' or v like '%binh%' then return 'bình'; end if;
  if v like '%chai%' then return 'chai'; end if;
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
  if v like '%thùng%' or v like '%thung%' or v like '%carton%' then return 'thùng'; end if;
  if v like '%lon%' then return 'lon'; end if;
  if v like '%hộp%' or v like '%hop%' then return 'hộp'; end if;
  if v like '%hũ%' or v like '%hủ%' or v ~ '(^|[^a-z])hu([^a-z]|$)' then return 'hũ'; end if;
  if v like '%bao%' then return 'bao'; end if;
  if v like '%bịch%' or v like '%bich%' or v like '%túi%' or v like '%tui%' then return 'bịch'; end if;
  if v like '%gói%' or v like '%goi%' then return 'gói'; end if;
  if v like '%bình%' or v like '%binh%' then return 'bình'; end if;
  if v like '%chai%' then return 'chai'; end if;

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
  if c like '%bột%' or c like '%bot%' or c like '%bôt%' or c like '%cacao%' then return 'bịch'; end if;
  if c like '%trà%' or c like '%tra%' then return 'gói'; end if;
  if c like '%ống%' or c like '%ông hút%' or c like '%ong%' or c like '%hut%' or c like '%muỗng%' or c like '%muong%' or c like '%nắp%' or c like '%nap%' or c like '%bao ly%' then return 'bịch'; end if;
  if c like '%mỳ cay%' or c like '%mì cay%' or c like '%my cay%' or c like '%mi cay%' then
    if v like '%koreno%' or v like '%mì%' or v like '% mi %' then return 'thùng'; end if;
    return 'gói';
  end if;
  if c like '%đông lạnh%' or c like '%dong lanh%' or c like '%thực phẩm đông lạnh%' or c like '%thuc pham dong lanh%' then return 'gói'; end if;
  return 'cái';
end;
$$;

update public.product_variants set updated_at = now();
