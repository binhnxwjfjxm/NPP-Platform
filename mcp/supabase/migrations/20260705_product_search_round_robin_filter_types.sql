-- Gate 7H follow-up: round-robin filter groups so the picker sees all groups.

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
      select * from matched order by type_rank, public.mcp_catalog_filter_order(filter_type), name, variant_name, variant_id limit v_limit
    )
    select jsonb_agg(jsonb_build_object('productId', product_id, 'variantId', variant_id, 'name', name, 'brand', brand, 'category', filter_type, 'rawCategory', raw_category, 'sku', sku, 'variantName', variant_name, 'sizeLabel', size_label, 'sellUnit', sell_unit, 'packUnit', pack_unit, 'packQuantity', pack_quantity, 'price', base_price) order by type_rank, public.mcp_catalog_filter_order(filter_type), name, variant_name, variant_id)
    from limited
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.mcp_search_products(text, text, text, integer) to anon, authenticated, service_role;
