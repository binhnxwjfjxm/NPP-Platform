-- Gate 7G: make product picker usable by returning a balanced catalog list
-- and allowing a broad milk-tea ingredient group filter.

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
    with matched as (
      select
        p.id as product_id,
        v.id as variant_id,
        p.name,
        coalesce(nullif(p.brand_name, ''), b.brand_name, p.brand_code) as brand,
        p.category,
        v.sku,
        v.variant_name,
        v.size_label,
        v.sell_unit,
        v.pack_unit,
        v.pack_quantity,
        v.base_price,
        row_number() over (partition by p.category order by p.name, v.variant_name, v.id) as category_rank
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join public.product_brands b on b.brand_code = p.brand_code
      where p.status = 'active'
        and v.status = 'active'
        and (
          v_category = ''
          or lower(p.category) = v_category
          or (
            v_category in ('nguyen lieu tra sua', 'nguyên liệu trà sữa', 'nl tra sua', 'nl trà sữa', 'tra sua', 'trà sữa')
            and lower(p.category) in (
              'siro','sinh tố','đường đen','trân châu','3q / thạch','trái cây hộp','bôt sua','bot cacao','flan / pudding','sốt topping','rau câu','sữa đặc','trà các loại'
            )
          )
        )
        and (
          v_brand = ''
          or lower(p.brand_code) = v_brand
          or lower(coalesce(p.brand_name, '')) = v_brand
          or lower(coalesce(b.brand_name, '')) = v_brand
        )
        and (
          v_q = ''
          or lower(p.id) like '%' || v_q || '%'
          or lower(v.id) like '%' || v_q || '%'
          or lower(p.name) like '%' || v_q || '%'
          or lower(coalesce(v.variant_name, '')) like '%' || v_q || '%'
          or lower(coalesce(v.sku, '')) like '%' || v_q || '%'
          or lower(coalesce(v.size_label, '')) like '%' || v_q || '%'
          or lower(p.category) like '%' || v_q || '%'
          or lower(coalesce(p.brand_name, '')) like '%' || v_q || '%'
          or lower(coalesce(b.brand_name, '')) like '%' || v_q || '%'
        )
    ), limited as (
      select *
      from matched
      order by category_rank, category, name, variant_name, variant_id
      limit v_limit
    )
    select jsonb_agg(
      jsonb_build_object(
        'productId', product_id,
        'variantId', variant_id,
        'name', name,
        'brand', brand,
        'category', category,
        'sku', sku,
        'variantName', variant_name,
        'sizeLabel', size_label,
        'sellUnit', sell_unit,
        'packUnit', pack_unit,
        'packQuantity', pack_quantity,
        'price', base_price
      ) order by category_rank, category, name, variant_name, variant_id
    )
    from limited
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.mcp_search_products(text, text, text, integer) to anon, authenticated, service_role;
