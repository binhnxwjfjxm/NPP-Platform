-- Export current product filter mapping for manual review.

create or replace function public.mcp_catalog_review_export()
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'generatedAt', now(),
    'summary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'filterType', filter_type,
        'filterOrder', filter_order,
        'products', product_count,
        'variants', variant_count,
        'rawCategories', raw_categories
      ) order by filter_order, filter_type)
      from (
        select
          public.mcp_catalog_filter_type(p.name, p.category, p.source_key) as filter_type,
          public.mcp_catalog_filter_order(public.mcp_catalog_filter_type(p.name, p.category, p.source_key)) as filter_order,
          count(distinct p.id) as product_count,
          count(v.id) as variant_count,
          string_agg(distinct p.category, ', ' order by p.category) as raw_categories
        from public.products p
        left join public.product_variants v on v.product_id = p.id
        group by 1, 2
      ) s
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(to_jsonb(t) order by filter_order, filter_type, product_name, product_id)
      from (
        with base as (
          select
            public.mcp_catalog_filter_type(p.name, p.category, p.source_key) as filter_type,
            public.mcp_catalog_filter_order(public.mcp_catalog_filter_type(p.name, p.category, p.source_key)) as filter_order,
            p.category as raw_category,
            p.id as product_id,
            p.source_key,
            p.name as product_name,
            coalesce(nullif(p.brand_name, ''), b.brand_name, p.brand_code) as brand,
            count(v.id) as variant_count,
            string_agg(distinct coalesce(v.sku,''), ', ' order by coalesce(v.sku,'')) as skus,
            string_agg(distinct coalesce(v.variant_name,''), ' | ' order by coalesce(v.variant_name,'')) as variant_names,
            string_agg(distinct coalesce(v.sell_unit,''), ', ' order by coalesce(v.sell_unit,'')) as sell_units,
            string_agg(distinct coalesce(v.size_label,''), ', ' order by coalesce(v.size_label,'')) as sizes,
            string_agg(distinct coalesce(v.pack_unit,''), ', ' order by coalesce(v.pack_unit,'')) as pack_units,
            min(v.base_price) as min_price,
            max(v.base_price) as max_price,
            p.status as product_status
          from public.products p
          left join public.product_brands b on b.brand_code = p.brand_code
          left join public.product_variants v on v.product_id = p.id
          group by p.id, p.source_key, p.name, p.category, p.brand_name, b.brand_name, p.brand_code, p.status
        )
        select *,
          concat_ws('; ',
            case when product_status <> 'active' then 'Ẩn/giá 0 hoặc chưa bán active' end,
            case when filter_type in ('Sữa','Kem / Milk foam') and raw_category = 'Thực phẩm đông lạnh' then 'Cần rà: hàng đông lạnh đang vào nhóm sữa/kem' end,
            case when filter_type = 'Kem / Milk foam' and lower(product_name) like '%phô mai%' and raw_category <> 'Bột sữa' then 'Cần rà: phô mai có thể là phụ gia/đông lạnh, không phải milk foam' end,
            case when filter_type = 'Trái cây / mứt' and lower(product_name) ~ '(atiso|đá me|da me|nước cốt dừa|nuoc cot dua|sen|thốt nốt|thot not)' then 'Cần rà: có thể không phải trái cây/mứt' end,
            case when filter_type = 'Đường & ngọt' and lower(product_name) like '%siro%' then 'Cần rà: tên siro nhưng đang vào đường/ngọt' end,
            case when sizes ~ '(^|, )0[0-9]{3} L' then 'Lỗi size: bị ăn số BGKQ thành L' end,
            case when sell_units = 'cái' and filter_type in ('Sữa','Bột','Topping','Đường & ngọt','Sinh tố','Trái cây / mứt','Kem / Milk foam','Phụ gia') then 'Cần rà: đơn vị cái có thể sai cho NL trà sữa' end
          ) as review_note
        from base
      ) t
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(to_jsonb(t) order by filter_order, filter_type, product_name, variant_name, variant_id)
      from (
        select
          public.mcp_catalog_filter_type(p.name, p.category, p.source_key) as filter_type,
          public.mcp_catalog_filter_order(public.mcp_catalog_filter_type(p.name, p.category, p.source_key)) as filter_order,
          p.category as raw_category,
          p.id as product_id,
          p.source_key,
          p.name as product_name,
          coalesce(nullif(p.brand_name, ''), b.brand_name, p.brand_code) as brand,
          v.id as variant_id,
          v.variant_name,
          v.size_label,
          v.sell_unit,
          v.pack_unit,
          v.pack_quantity,
          v.sku,
          v.base_price,
          p.status as product_status,
          v.status as variant_status,
          v.raw_options
        from public.products p
        left join public.product_brands b on b.brand_code = p.brand_code
        left join public.product_variants v on v.product_id = p.id
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.mcp_catalog_review_export() to anon, authenticated, service_role;
