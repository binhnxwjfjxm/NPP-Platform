-- Gate 7H: normalize product filters before sending catalog to order popup.
-- Product picker uses category labels returned by mcp_search_products as filter chips.

update public.products
set category = case category
  when 'Bôt Sua' then 'Bột sữa'
  when 'Bot Cacao' then 'Bột cacao'
  when 'Ông Hút' then 'Ống hút'
  when 'Đồ Lẻ' then 'Đồ lẻ'
  when 'Nguyên Liệu Mỳ Cay' then 'Nguyên liệu mì cay'
  when 'Thực Phẩm Đông Lạnh' then 'Thực phẩm đông lạnh'
  when 'Trà Các Loại' then 'Trà các loại'
  when 'Sữa Đặc' then 'Sữa đặc'
  when 'Bao Ly' then 'Bao ly'
  when 'Nguyên Liệu Bánh Tráng' then 'Nguyên liệu bánh tráng'
  else category
end,
updated_at = now()
where category in ('Bôt Sua','Bot Cacao','Ông Hút','Đồ Lẻ','Nguyên Liệu Mỳ Cay','Thực Phẩm Đông Lạnh','Trà Các Loại','Sữa Đặc','Bao Ly','Nguyên Liệu Bánh Tráng');

create or replace function public.mcp_catalog_filter_type(p_name text, p_category text, p_source_key text default null)
returns text
language plpgsql
immutable
as $$
declare
  n text := lower(coalesce(p_name, ''));
  c text := lower(coalesce(p_category, ''));
begin
  if c like '%trà%' or c like '%tra%' then return 'Trà'; end if;
  if c like '%siro%' then return 'Siro'; end if;
  if c like '%sinh tố%' or c like '%sinh to%' then return 'Sinh tố'; end if;
  if c like '%trái cây%' or c like '%trai cay%' or n like '%puree%' or n like '%mứt%' or n like '%mut%' then return 'Trái cây / mứt'; end if;
  if c like '%trân châu%' or c like '%tran chau%' or c like '%3q%' or c like '%thạch%' or c like '%thach%' or c like '%flan%' or c like '%rau câu%' or c like '%rau cau%' or n like '%pudding%' or n like '%sương sáo%' or n like '%suong sao%' then return 'Topping'; end if;
  if c like '%đường%' or c like '%duong%' or c like '%sốt topping%' or c like '%sot topping%' or n like '%mật ong%' or n like '%mat ong%' or n like '%sốt ngọt%' or n like '%sot ngot%' then return 'Đường & ngọt'; end if;
  if n like '%milkfoam%' or n like '%milk foam%' or n like '%milkfoarm%' or n like '%frappe%' or n like '%kem trứng%' or n like '%kem trung%' or n like '%rich%' or n like '%gas kem%' or n like '%phô mai%' or n like '%pho mai%' or n like '%whipping%' then return 'Kem / Milk foam'; end if;
  if c like '%bột cacao%' or c like '%bot cacao%' or n like '%matcha%' or n like '%cacao%' or n like '%ca cao%' or n like '%milo%' or n like '%bột môn%' or n like '%bot mon%' or n like '%bột khoai môn%' or n like '%bot khoai mon%' or n like '%bột sô%' or n like '%bot so%' then return 'Bột'; end if;
  if c like '%bột sữa%' or c like '%bot sua%' or c like '%sữa đặc%' or c like '%sua dac%' or n like '%sữa tươi%' or n like '%sua tuoi%' or n like '%frima%' or n like '%kievit%' or n like '%kem béo%' or n like '%kem beo%' then return 'Sữa'; end if;
  if n like '%hạt chia%' or n like '%hat chia%' or n like '%lá rong biển%' or n like '%la rong bien%' or n like '%gelatin%' or n like '%galatin%' or n like '%bột lắc%' or n like '%bot lac%' or n like '%đá me%' or n like '%da me%' or n like '%than tre%' then return 'Phụ gia'; end if;
  if c like '%ống hút%' or c like '%ong hut%' or c like '%muỗng%' or c like '%muong%' or c like '%nắp%' or c like '%nap%' or c like '%bao ly%' or c like '%bao bì%' or c like '%bao bi%' then return 'Bao bì'; end if;
  if c like '%mì cay%' or c like '%mi cay%' or c like '%mỳ cay%' or c like '%my cay%' then return 'Mì cay'; end if;
  if c like '%đông lạnh%' or c like '%dong lanh%' then return 'Đông lạnh'; end if;
  if c like '%bánh tráng%' or c like '%banh trang%' then return 'Bánh tráng'; end if;
  return coalesce(nullif(p_category, ''), 'Khác');
end;
$$;

create or replace function public.mcp_catalog_filter_order(p_filter_type text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(p_filter_type, ''))
    when 'trà' then 10
    when 'sữa' then 20
    when 'siro' then 30
    when 'bột' then 40
    when 'topping' then 50
    when 'đường & ngọt' then 60
    when 'sinh tố' then 70
    when 'trái cây / mứt' then 80
    when 'kem / milk foam' then 90
    when 'phụ gia' then 100
    when 'bao bì' then 200
    when 'mì cay' then 210
    when 'đông lạnh' then 220
    when 'bánh tráng' then 230
    else 999
  end;
$$;

create or replace function public.mcp_search_products(
  p_q text default null,
  p_category text default null,
  p_brand text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_q text := lower(btrim(coalesce(p_q, '')));
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_brand text := lower(btrim(coalesce(p_brand, '')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  return coalesce((
    with source as (
      select p.id product_id, v.id variant_id, p.name, coalesce(nullif(p.brand_name, ''), b.brand_name, p.brand_code) brand, p.category raw_category, public.mcp_catalog_filter_type(p.name, p.category, p.source_key) filter_type, v.sku, v.variant_name, v.size_label, v.sell_unit, v.pack_unit, v.pack_quantity, v.base_price
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join public.product_brands b on b.brand_code = p.brand_code
      where p.status = 'active' and v.status = 'active'
    ), matched as (
      select *, row_number() over (partition by filter_type order by name, variant_name, variant_id) type_rank
      from source
      where (v_category = '' or lower(filter_type) = v_category or lower(raw_category) = v_category or (v_category in ('nguyen lieu tra sua','nguyên liệu trà sữa','nl tra sua','nl trà sữa','tra sua','trà sữa') and lower(filter_type) in ('trà','sữa','siro','bột','topping','đường & ngọt','sinh tố','trái cây / mứt','kem / milk foam','phụ gia')))
        and (v_brand = '' or lower(brand) = v_brand)
        and (v_q = '' or lower(product_id) like '%' || v_q || '%' or lower(variant_id) like '%' || v_q || '%' or lower(name) like '%' || v_q || '%' or lower(coalesce(variant_name, '')) like '%' || v_q || '%' or lower(coalesce(sku, '')) like '%' || v_q || '%' or lower(coalesce(size_label, '')) like '%' || v_q || '%' or lower(raw_category) like '%' || v_q || '%' or lower(filter_type) like '%' || v_q || '%' or lower(coalesce(brand, '')) like '%' || v_q || '%')
    ), limited as (
      select * from matched order by public.mcp_catalog_filter_order(filter_type), type_rank, name, variant_name, variant_id limit v_limit
    )
    select jsonb_agg(jsonb_build_object('productId', product_id, 'variantId', variant_id, 'name', name, 'brand', brand, 'category', filter_type, 'rawCategory', raw_category, 'sku', sku, 'variantName', variant_name, 'sizeLabel', size_label, 'sellUnit', sell_unit, 'packUnit', pack_unit, 'packQuantity', pack_quantity, 'price', base_price) order by public.mcp_catalog_filter_order(filter_type), type_rank, name, variant_name, variant_id)
    from limited
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.mcp_search_products(text, text, text, integer) to anon, authenticated, service_role;

create or replace function public.mcp_get_product_variants(p_product_id text)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_product_id text := btrim(coalesce(p_product_id, ''));
begin
  if v_product_id = '' then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('productId', p.id, 'variantId', v.id, 'name', p.name, 'brand', coalesce(nullif(p.brand_name, ''), b.brand_name, p.brand_code), 'category', public.mcp_catalog_filter_type(p.name, p.category, p.source_key), 'rawCategory', p.category, 'sku', v.sku, 'variantName', v.variant_name, 'sizeLabel', v.size_label, 'sellUnit', v.sell_unit, 'packUnit', v.pack_unit, 'packQuantity', v.pack_quantity, 'price', v.base_price) order by v.variant_name, v.size_label, v.id)
    from public.product_variants v
    join public.products p on p.id = v.product_id
    left join public.product_brands b on b.brand_code = p.brand_code
    where p.id = v_product_id and p.status = 'active' and v.status = 'active'
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.mcp_get_product_variants(text) to anon, authenticated, service_role;
