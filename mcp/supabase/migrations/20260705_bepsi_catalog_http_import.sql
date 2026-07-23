-- Gate 7D: import initial product catalog from Bếp Sỉ / F-B-Order.
-- Source discovered from uploaded src/product-catalog.js:
-- https://raw.githubusercontent.com/gustavjung01/F-B-Order/main/data/catalog/hung-phat/v2/products.csv

create extension if not exists http with schema extensions;

create or replace function public.mcp_csv_line_to_fields(p_line text)
returns text[]
language plpgsql
immutable
as $$
declare
  fields text[] := array[]::text[];
  field text := '';
  i integer := 1;
  c text;
  n text;
  quoted boolean := false;
begin
  while i <= length(coalesce(p_line, '')) loop
    c := substr(p_line, i, 1);
    n := substr(p_line, i + 1, 1);

    if quoted then
      if c = '"' and n = '"' then
        field := field || '"';
        i := i + 1;
      elsif c = '"' then
        quoted := false;
      else
        field := field || c;
      end if;
    else
      if c = '"' then
        quoted := true;
      elsif c = ',' then
        fields := array_append(fields, btrim(field));
        field := '';
      else
        field := field || c;
      end if;
    end if;
    i := i + 1;
  end loop;

  fields := array_append(fields, btrim(field));
  return fields;
end;
$$;

create or replace function public.mcp_bepsi_clean(p_value text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g'));
$$;

create or replace function public.mcp_bepsi_source_sku(p_image_key text, p_product_key text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(nullif(p_image_key, ''), p_product_key));
  m text[];
begin
  m := regexp_match(v, 'bgkq-?([0-9]+)');
  if m is not null then
    return 'BGKQ-' || lpad(m[1], 4, '0');
  end if;
  m := regexp_match(lower(coalesce(p_product_key, '')), '([0-9]{4})$');
  if m is not null then
    return 'BGKQ-' || lpad(m[1], 4, '0');
  end if;
  return upper(coalesce(p_product_key, ''));
end;
$$;

create or replace function public.mcp_bepsi_brand_code(p_brand text, p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(nullif(p_brand, ''), p_name, ''));
  compact text;
begin
  if v like '%torani%' then return 'TO'; end if;
  if v like '%pixe%' then return 'PI'; end if;
  if v like '%ding%' then return 'DF'; end if;
  if v like '%gold%' or v like '%golden%' or v like '%glod%' then return 'GO'; end if;
  if v like '%gtp%' then return 'GT'; end if;
  if v like '%vina%' then return 'VI'; end if;
  if v like '%carisa%' then return 'CA'; end if;
  if v like '%chang%' then return 'CT'; end if;
  if v like '%douxian%' or v like '%duoxian%' then return 'DO'; end if;
  if v like '%berrino%' or v like '%berino%' then return 'BE'; end if;
  if v like '%bibi%' then return 'BI'; end if;
  if v like '%sea%' then return 'SE'; end if;
  if v like '%zion%' then return 'ZI'; end if;
  if v like '%ok%' then return 'OK'; end if;
  if v like '%hershey%' then return 'HE'; end if;
  if v like '%koreno%' then return 'KO'; end if;
  compact := regexp_replace(upper(coalesce(nullif(p_brand, ''), 'NO')), '[^A-Z0-9]', '', 'g');
  return rpad(coalesce(nullif(substr(compact, 1, 2), ''), 'NO'), 2, 'X');
end;
$$;

create or replace function public.mcp_bepsi_category_info(p_category text)
returns table(industry_code text, industry_name text, category_name text)
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_category, ''));
begin
  if v like '%siro%' then return query select 'T', 'Nguyên liệu trà sữa', 'Siro';
  elsif v like '%sinh%' then return query select 'T', 'Nguyên liệu trà sữa', 'Sinh tố';
  elsif v like '%đường%' or v like '%duong%' then return query select 'T', 'Nguyên liệu trà sữa', 'Đường đen';
  elsif v like '%trân%' or v like '%tran%' then return query select 'T', 'Nguyên liệu trà sữa', 'Trân châu';
  elsif v like '%3q%' or v like '%thach%' or v like '%thạch%' then return query select 'T', 'Nguyên liệu trà sữa', '3Q / thạch';
  elsif v like '%topping%' then return query select 'T', 'Nguyên liệu trà sữa', 'Sốt topping';
  elsif v like '%cây%' or v like '%cay hop%' or v like '%hôp%' or v like '%hop%' then return query select 'T', 'Nguyên liệu trà sữa', 'Trái cây hộp';
  elsif v like '%rau%' then return query select 'T', 'Nguyên liệu trà sữa', 'Rau câu';
  elsif v like '%flan%' then return query select 'T', 'Nguyên liệu trà sữa', 'Flan / pudding';
  elsif v like '%bột%' or v like '%bot%' or v like '%sữa%' or v like '%sua%' or v like '%cacao%' or v like '%trà%' or v like '%tra%' then return query select 'T', 'Nguyên liệu trà sữa', public.mcp_bepsi_clean(p_category);
  elsif v like '%ống%' or v like '%ong%' or v like '%muỗng%' or v like '%muong%' or v like '%nắp%' or v like '%nap%' or v like '%bao ly%' then return query select 'P', 'Ly/bao bì/phụ kiện', public.mcp_bepsi_clean(p_category);
  elsif v like '%mì%' or v like '%mi%' then return query select 'M', 'Nguyên liệu mì cay', public.mcp_bepsi_clean(p_category);
  elsif v like '%đông%' or v like '%dong%' or v like '%lạnh%' or v like '%lanh%' then return query select 'F', 'Đông lạnh', public.mcp_bepsi_clean(p_category);
  else return query select 'D', 'Đồ lẻ / phụ trợ', coalesce(nullif(public.mcp_bepsi_clean(p_category), ''), 'Khác');
  end if;
end;
$$;

create or replace function public.mcp_bepsi_size(p_product_key text, p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_product_key, '') || ' ' || coalesce(p_name, ''));
begin
  if v like '%2-5kg%' or v like '%2.5kg%' then return '2,5 kg'; end if;
  if v like '%650g%' or v like '%650gram%' then return '650 g'; end if;
  if v like '%700ml%' then return '700 ml'; end if;
  if v like '%730ml%' then return '730 ml'; end if;
  if v like '%750ml%' then return '750 ml'; end if;
  if v like '%760ml%' then return '760 ml'; end if;
  if v like '%930ml%' then return '930 ml'; end if;
  if v like '%500gr%' or v like '%500g%' then return '500 g'; end if;
  if v like '%1kg%' or v like '%1 kg%' then return '1 kg'; end if;
  if v like '%2kg%' or v like '%2 kg%' then return '2 kg'; end if;
  if v like '%3kg%' or v like '%3 kg%' then return '3 kg'; end if;
  if v like '%1l%' or v like '%1 lit%' then return '1 L'; end if;
  if v like '%2l%' or v like '%2 lit%' then return '2 L'; end if;
  return '';
end;
$$;

create or replace function public.mcp_bepsi_unit(p_product_key text, p_name text, p_category text, p_size text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_product_key, '') || ' ' || coalesce(p_name, '') || ' ' || coalesce(p_category, '') || ' ' || coalesce(p_size, ''));
begin
  if v like '%siro%' or v like '%sinh%' or v like '%đường%' or v like '%duong%' or v like '%topping%' then
    if v like '%2l%' or v like '%2 lit%' or v like '%bình%' or v like '%binh%' then return 'bình'; end if;
    return 'chai';
  end if;
  if v like '%kg%' or v like '%bao%' or v like '%bịch%' or v like '%bich%' then return 'bịch'; end if;
  if v like '%ống%' or v like '%ong%' or v like '%muỗng%' or v like '%muong%' or v like '%nắp%' or v like '%nap%' or v like '%bao ly%' then return 'bịch'; end if;
  if v like '%đông%' or v like '%dong%' or v like '%lạnh%' or v like '%lanh%' then return 'gói'; end if;
  return 'cái';
end;
$$;

create or replace function public.mcp_bepsi_choices(p_source_key text, p_size text)
returns text[]
language plpgsql
immutable
as $$
begin
  case p_source_key
    when 'siro-thai-pixe-bgkq-0002' then return array['Dâu','Đào','Nho','Kiwi','Chanh dây','Phúc bồn tử','Dưa lưới','Vải','Cam','Việt quất','Táo xanh','Blue Curacao','Bạc hà','Sô-cô-la','Trà xanh Matcha','Hỗn hợp trái cây (Blue Punch)','Khoai môn','Cookies'];
    when 'siro-thai-dingfong-bgkq-0003' then return array['Blue Hawaii','Dưa hấu','Nho','Xoài','Bạc hà','Chanh dây','Đào','Dâu','Dưa lưới','Táo xanh','Vải','Việt quất'];
    when 'siro-gold-2l-bgkq-0004' then return array['Bạc hà','Cam','Caramel','Chanh','Chanh dây','Đào','Dâu','Dừa','Dưa hấu','Dưa lưới','Đường đen','Khoai môn'];
    when 'siro-gold-700ml-bgkq-0005' then return array['Việt quất','Dâu','Chanh','Vải','Thơm','Mãng cầu','Kiwi','Chanh dây','Đào','Dưa hấu','Ổi hồng','Xoài','Dưa lưới','Nhãn','Lựu','Trái cây nhiệt đới'];
    when 'siro-gtp-bgkq-0006' then return array['Trái cây nhiệt đới','Sâm dứa','Ổi xá lị','Khoai môn','Việt quất','Phúc bồn tử','Chanh dây','Dưa lưới','Bạc hà','Kiwi','Vải','Nho','Táo xanh','Đào','Cam','Đường đen','Sô-cô-la','Dâu','Caramel','Blue Curacao'];
    when 'siro-vina-bgkq-0008' then return array['Dâu','Đào','Vải','Ổi','Việt quất','Phúc bồn tử','Bạc hà','Khoai môn','Blue Curacao','Sâm dứa','Dưa lưới','Kiwi','Táo xanh','Chanh dây','Xoài','Măng cụt','Mật ong'];
    when 'siro-carisa-bgkq-0010' then return array['Chanh xanh','Sâm dứa','Dưa lưới','Vải','Đào','Khoai môn','Cam','Dâu','Ổi hồng','Việt quất','Chanh dây','Me','Mơ','Lựu','Sầu riêng','Sô-cô-la'];
    when 'siro-changthai-bgkq-0011' then return array['Đào','Khoai môn','Mãng cầu','Ổi','Blue Curacao','Bạc hà','Trà xanh','Kiwi','Táo xanh','Phúc bồn tử','Dưa lưới','Xoài','Chanh dây','Việt quất','Dâu','Vải'];
    when 'siro-douxian-2l-tron-bgkq-0012' then return array['Dâu','Đào','Vải','Bạc hà','Chanh','Đường đen','Dưa lưới','Táo xanh','Việt quất','Sô-cô-la'];
    when 'siro-douxian-2l-hoang-kim-bgkq-0014' then return array['Đào'];
    else return array[coalesce(nullif(p_size, ''), 'Mặc định')];
  end case;
end;
$$;

create or replace function public.mcp_import_bepsi_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  source_url constant text := 'https://raw.githubusercontent.com/gustavjung01/F-B-Order/main/data/catalog/hung-phat/v2/products.csv';
  source_repo constant text := 'gustavjung01/F-B-Order';
  version constant text := 'bepsi-hung-phat-v2-safe-1';
  resp extensions.http_response;
  lines text[];
  fields text[];
  line text;
  i integer;
  source_key text;
  name text;
  brand text;
  category text;
  image_key text;
  price numeric;
  sku text;
  seq text;
  b_code text;
  size_label text;
  sell_unit text;
  product_id text;
  choice text;
  choice_index integer;
  choices text[];
  ci record;
  product_count integer := 0;
  variant_count integer := 0;
begin
  resp := extensions.http_get(source_url);
  if resp.status <> 200 then
    raise exception 'bepsi_catalog_fetch_failed_%', resp.status using errcode = 'HV000';
  end if;

  lines := string_to_array(replace(resp.content, E'\r\n', E'\n'), E'\n');

  for i in 2..coalesce(array_length(lines, 1), 0) loop
    line := nullif(btrim(lines[i]), '');
    if line is null then continue; end if;

    fields := public.mcp_csv_line_to_fields(line);
    source_key := public.mcp_bepsi_clean(fields[1]);
    if source_key = '' or source_key in ('siro-gtp-dau-duong-den-bgkq-0007', 'siro-sam-dua-vina-bgkq-0009') then continue; end if;

    name := public.mcp_bepsi_clean(fields[2]);
    brand := coalesce(nullif(public.mcp_bepsi_clean(fields[3]), ''), 'No brand / chưa rõ');
    category := public.mcp_bepsi_clean(fields[4]);
    image_key := public.mcp_bepsi_clean(fields[5]);
    price := greatest(coalesce(nullif(public.mcp_bepsi_clean(fields[6]), '')::numeric, 0), 0);
    sku := public.mcp_bepsi_source_sku(image_key, source_key);
    seq := lpad(coalesce((regexp_match(sku, '([0-9]+)'))[1], '0'), 4, '0');
    b_code := public.mcp_bepsi_brand_code(brand, name);
    size_label := public.mcp_bepsi_size(source_key, name);
    sell_unit := public.mcp_bepsi_unit(source_key, name, category, size_label);

    select * into ci from public.mcp_bepsi_category_info(category) limit 1;
    product_id := ci.industry_code || '-' || b_code || '-' || seq;

    if source_key = 'siro-gold-2l-bgkq-0004' then name := 'Siro Golden Farm 2 L'; end if;
    if source_key = 'siro-gold-700ml-bgkq-0005' then name := 'Siro Golden Farm 700 ml'; end if;
    if source_key = 'siro-douxian-2l-tron-bgkq-0012' then name := 'Siro Douxian 2,5 kg bình tròn'; end if;
    if source_key = 'siro-douxian-2l-hoang-kim-bgkq-0014' then name := 'Siro Douxian 2,5 kg bình vuông'; end if;

    insert into public.product_categories (industry_code, name, status, sort_order, note, raw_payload)
    values (ci.industry_code, ci.industry_name, 'active', 100, 'Seed từ Bếp Sỉ / F-B-Order', jsonb_build_object('source', source_repo, 'version', version))
    on conflict (industry_code) do update set name = excluded.name, status = 'active', raw_payload = product_categories.raw_payload || excluded.raw_payload, updated_at = now();

    insert into public.product_brands (brand_code, brand_name, status, sort_order, note, raw_payload)
    values (b_code, brand, 'active', 100, 'Seed từ Bếp Sỉ / F-B-Order', jsonb_build_object('source', source_repo, 'version', version))
    on conflict (brand_code) do update set brand_name = excluded.brand_name, status = 'active', raw_payload = product_brands.raw_payload || excluded.raw_payload, updated_at = now();

    insert into public.products (id, industry_code, brand_code, name, category, brand_name, status, source_key, raw_payload)
    values (product_id, ci.industry_code, b_code, name, ci.category_name, brand, case when price > 0 then 'active' else 'hidden' end, source_key, jsonb_build_object('source', source_repo, 'source_url', source_url, 'source_key', source_key, 'source_sku', sku, 'source_row', jsonb_build_object('product_key', source_key, 'name', fields[2], 'brand', fields[3], 'category', fields[4], 'image_key', image_key, 'price_from', fields[6], 'status', fields[7]), 'version', version))
    on conflict (id) do update set industry_code = excluded.industry_code, brand_code = excluded.brand_code, name = excluded.name, category = excluded.category, brand_name = excluded.brand_name, status = excluded.status, source_key = excluded.source_key, raw_payload = excluded.raw_payload, updated_at = now();
    product_count := product_count + 1;

    choices := public.mcp_bepsi_choices(source_key, size_label);
    choice_index := 0;
    foreach choice in array choices loop
      choice_index := choice_index + 1;
      insert into public.product_variants (id, product_id, sku, variant_name, size_label, sell_unit, pack_unit, pack_quantity, base_price, status, raw_options, raw_payload)
      values (
        product_id || '-' || lpad(choice_index::text, 2, '0'),
        product_id,
        sku,
        case when choice = 'Mặc định' then coalesce(nullif(size_label, ''), 'Mặc định') else choice end,
        nullif(size_label, ''),
        sell_unit,
        null,
        null,
        price,
        case when price > 0 then 'active' else 'hidden' end,
        case when choice = 'Mặc định' then '{}'::jsonb else jsonb_build_object('flavor', choice) end,
        jsonb_build_object('source', source_repo, 'source_key', source_key, 'source_sku', sku, 'version', version)
      )
      on conflict (id) do update set product_id = excluded.product_id, sku = excluded.sku, variant_name = excluded.variant_name, size_label = excluded.size_label, sell_unit = excluded.sell_unit, base_price = excluded.base_price, status = excluded.status, raw_options = excluded.raw_options, raw_payload = excluded.raw_payload, updated_at = now();
      variant_count := variant_count + 1;
    end loop;
  end loop;

  return jsonb_build_object('source', source_repo, 'sourceUrl', source_url, 'products', product_count, 'variants', variant_count, 'version', version);
end;
$$;

grant execute on function public.mcp_import_bepsi_catalog() to service_role;

select public.mcp_import_bepsi_catalog();
