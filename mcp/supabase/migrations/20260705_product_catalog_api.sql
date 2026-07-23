-- Gate 7B: product catalog API RPC helpers.
-- Keep search logic in DB so the Next routes stay thin and do not duplicate product matching rules.

create or replace function public.mcp_search_products(
  p_q text default null,
  p_category text default null,
  p_brand text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := lower(btrim(coalesce(p_q, '')));
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_brand text := lower(btrim(coalesce(p_brand, '')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
begin
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.name, t."variantName", t."variantId")
    from (
      select
        p.id as "productId",
        v.id as "variantId",
        p.name,
        coalesce(nullif(p.brand_name, ''), b.brand_name, p.brand_code) as brand,
        p.category,
        v.sku,
        v.variant_name as "variantName",
        v.size_label as "sizeLabel",
        v.sell_unit as "sellUnit",
        v.pack_unit as "packUnit",
        v.pack_quantity as "packQuantity",
        v.base_price as price
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join public.product_brands b on b.brand_code = p.brand_code
      where p.status = 'active'
        and v.status = 'active'
        and (v_category = '' or lower(p.category) = v_category)
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
      limit v_limit
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_get_product_variants(p_product_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_product_id text := btrim(coalesce(p_product_id, ''));
begin
  if v_product_id = '' then
    raise exception 'product_id_required' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t."variantName", t."variantId")
    from (
      select
        p.id as "productId",
        v.id as "variantId",
        p.name,
        coalesce(nullif(p.brand_name, ''), b.brand_name, p.brand_code) as brand,
        p.category,
        v.sku,
        v.variant_name as "variantName",
        v.size_label as "sizeLabel",
        v.sell_unit as "sellUnit",
        v.pack_unit as "packUnit",
        v.pack_quantity as "packQuantity",
        v.base_price as price
      from public.product_variants v
      join public.products p on p.id = v.product_id
      left join public.product_brands b on b.brand_code = p.brand_code
      where p.id = v_product_id
        and p.status = 'active'
        and v.status = 'active'
    ) t
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.mcp_search_products(text, text, text, integer) to anon, authenticated, service_role;
grant execute on function public.mcp_get_product_variants(text) to anon, authenticated, service_role;
