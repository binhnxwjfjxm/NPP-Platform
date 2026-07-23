create or replace function public.mcp_create_report_setting_group(
  p_group_key text,
  p_title text,
  p_group_type text default 'market_report',
  p_description text default null,
  p_sort_order integer default 0,
  p_status text default 'active',
  p_meta jsonb default '{}'::jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_group public.mcp_setting_groups%rowtype;
  v_group_key text := lower(btrim(coalesce(p_group_key, '')));
  v_title text := btrim(coalesce(p_title, ''));
  v_group_type text := lower(btrim(coalesce(p_group_type, 'market_report')));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_status text := lower(btrim(coalesce(p_status, 'active')));
begin
  if v_group_key = '' or length(v_group_key) > 120 or v_group_key !~ '^[a-z0-9]+(_[a-z0-9]+)*$' then
    raise exception 'invalid_group_key' using errcode = '23514';
  end if;
  if v_title = '' then
    raise exception 'title_required' using errcode = '23514';
  end if;
  if length(v_title) > 200 then
    raise exception 'invalid_title' using errcode = '23514';
  end if;
  if v_group_type !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'invalid_group_type' using errcode = '23514';
  end if;
  if v_status not in ('active', 'inactive') then
    raise exception 'invalid_setting_status' using errcode = '23514';
  end if;
  if p_sort_order < 0 or p_sort_order > 100000 then
    raise exception 'invalid_sort_order' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_meta, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_meta' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_context' using errcode = '23514';
  end if;

  begin
    insert into public.mcp_setting_groups (
      group_key,
      title,
      group_type,
      description,
      sort_order,
      status,
      raw_payload
    ) values (
      v_group_key,
      v_title,
      v_group_type,
      v_description,
      p_sort_order,
      v_status,
      coalesce(p_meta, '{}'::jsonb)
        || jsonb_build_object('foundation_context', coalesce(p_context, '{}'::jsonb))
    )
    returning * into v_group;
  exception
    when unique_violation then
      raise exception 'report_setting_group_key_conflict' using errcode = '23505';
  end;

  return to_jsonb(v_group);
end;
$function$;

create or replace function public.mcp_update_report_setting_group(
  p_group_id text,
  p_patch jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_group public.mcp_setting_groups%rowtype;
  v_group_key text;
  v_title text;
  v_sort_order integer;
  v_status text;
begin
  if nullif(btrim(coalesce(p_group_id, '')), '') is null then
    raise exception 'group_id_required' using errcode = '23514';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'report_setting_patch_required' using errcode = '23514';
  end if;
  if exists (
    select 1
      from jsonb_object_keys(p_patch) as keys(key)
     where key not in ('group_key', 'title', 'description', 'sort_order', 'status', 'meta')
  ) then
    raise exception 'invalid_report_setting_group_patch' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_context' using errcode = '23514';
  end if;

  select *
    into v_group
    from public.mcp_setting_groups
   where id = p_group_id
   for update;

  if not found then
    raise exception 'report_setting_group_not_found' using errcode = '23503';
  end if;

  if p_patch ? 'group_key' then
    v_group_key := lower(btrim(coalesce(p_patch->>'group_key', '')));
    if v_group_key = '' or length(v_group_key) > 120 or v_group_key !~ '^[a-z0-9]+(_[a-z0-9]+)*$' then
      raise exception 'invalid_group_key' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'title' then
    v_title := btrim(coalesce(p_patch->>'title', ''));
    if v_title = '' then
      raise exception 'title_required' using errcode = '23514';
    end if;
    if length(v_title) > 200 then
      raise exception 'invalid_title' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'sort_order' then
    begin
      v_sort_order := (p_patch->>'sort_order')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'invalid_sort_order' using errcode = '23514';
    end;
    if v_sort_order < 0 or v_sort_order > 100000 then
      raise exception 'invalid_sort_order' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'status' then
    v_status := lower(btrim(coalesce(p_patch->>'status', '')));
    if v_status not in ('active', 'inactive') then
      raise exception 'invalid_setting_status' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'meta' and jsonb_typeof(p_patch->'meta') <> 'object' then
    raise exception 'invalid_meta' using errcode = '23514';
  end if;

  begin
    update public.mcp_setting_groups
       set group_key = case when p_patch ? 'group_key' then v_group_key else v_group.group_key end,
           title = case when p_patch ? 'title' then v_title else v_group.title end,
           description = case
             when p_patch ? 'description' then nullif(btrim(coalesce(p_patch->>'description', '')), '')
             else v_group.description
           end,
           sort_order = case when p_patch ? 'sort_order' then v_sort_order else v_group.sort_order end,
           status = case when p_patch ? 'status' then v_status else v_group.status end,
           raw_payload = coalesce(v_group.raw_payload, '{}'::jsonb)
             || case when p_patch ? 'meta' then p_patch->'meta' else '{}'::jsonb end
             || jsonb_build_object('foundation_context', coalesce(p_context, '{}'::jsonb)),
           updated_at = now()
     where id = v_group.id
     returning * into v_group;
  exception
    when unique_violation then
      raise exception 'report_setting_group_key_conflict' using errcode = '23505';
  end;

  return to_jsonb(v_group);
end;
$function$;

create or replace function public.mcp_create_report_setting_item(
  p_group_id text,
  p_item_key text,
  p_label text,
  p_value text default null,
  p_category text default null,
  p_brand_name text default null,
  p_product_id text default null,
  p_sort_order integer default 0,
  p_status text default 'active',
  p_meta jsonb default '{}'::jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_item public.mcp_setting_items%rowtype;
  v_item_key text := lower(btrim(coalesce(p_item_key, '')));
  v_label text := btrim(coalesce(p_label, ''));
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_brand_name text := nullif(btrim(coalesce(p_brand_name, '')), '');
  v_product_id text := nullif(btrim(coalesce(p_product_id, '')), '');
  v_status text := lower(btrim(coalesce(p_status, 'active')));
begin
  if nullif(btrim(coalesce(p_group_id, '')), '') is null then
    raise exception 'group_id_required' using errcode = '23514';
  end if;
  if v_item_key = '' or length(v_item_key) > 120 or v_item_key !~ '^[a-z0-9]+(_[a-z0-9]+)*$' then
    raise exception 'invalid_item_key' using errcode = '23514';
  end if;
  if v_label = '' then
    raise exception 'label_required' using errcode = '23514';
  end if;
  if length(v_label) > 200 then
    raise exception 'invalid_label' using errcode = '23514';
  end if;
  if v_status not in ('active', 'inactive') then
    raise exception 'invalid_setting_status' using errcode = '23514';
  end if;
  if p_sort_order < 0 or p_sort_order > 100000 then
    raise exception 'invalid_sort_order' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_meta, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_meta' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_context' using errcode = '23514';
  end if;

  perform 1
    from public.mcp_setting_groups
   where id = p_group_id
   for key share;

  if not found then
    raise exception 'report_setting_group_not_found' using errcode = '23503';
  end if;

  begin
    insert into public.mcp_setting_items (
      group_id,
      item_key,
      label,
      value,
      category,
      brand_name,
      product_id,
      sort_order,
      status,
      raw_payload
    ) values (
      p_group_id,
      v_item_key,
      v_label,
      coalesce(v_value, v_label),
      v_category,
      v_brand_name,
      v_product_id,
      p_sort_order,
      v_status,
      coalesce(p_meta, '{}'::jsonb)
        || jsonb_build_object('foundation_context', coalesce(p_context, '{}'::jsonb))
    )
    returning * into v_item;
  exception
    when unique_violation then
      raise exception 'report_setting_item_key_conflict' using errcode = '23505';
    when foreign_key_violation then
      raise exception 'report_setting_product_not_found' using errcode = '23503';
  end;

  return to_jsonb(v_item);
end;
$function$;

create or replace function public.mcp_update_report_setting_item(
  p_item_id text,
  p_patch jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_item public.mcp_setting_items%rowtype;
  v_item_key text;
  v_label text;
  v_sort_order integer;
  v_status text;
begin
  if nullif(btrim(coalesce(p_item_id, '')), '') is null then
    raise exception 'item_id_required' using errcode = '23514';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'report_setting_patch_required' using errcode = '23514';
  end if;
  if exists (
    select 1
      from jsonb_object_keys(p_patch) as keys(key)
     where key not in ('item_key', 'label', 'value', 'category', 'brand_name', 'product_id', 'sort_order', 'status', 'meta')
  ) then
    raise exception 'invalid_report_setting_item_patch' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_context' using errcode = '23514';
  end if;

  select *
    into v_item
    from public.mcp_setting_items
   where id = p_item_id
   for update;

  if not found then
    raise exception 'report_setting_item_not_found' using errcode = '23503';
  end if;

  if p_patch ? 'item_key' then
    v_item_key := lower(btrim(coalesce(p_patch->>'item_key', '')));
    if v_item_key = '' or length(v_item_key) > 120 or v_item_key !~ '^[a-z0-9]+(_[a-z0-9]+)*$' then
      raise exception 'invalid_item_key' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'label' then
    v_label := btrim(coalesce(p_patch->>'label', ''));
    if v_label = '' then
      raise exception 'label_required' using errcode = '23514';
    end if;
    if length(v_label) > 200 then
      raise exception 'invalid_label' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'sort_order' then
    begin
      v_sort_order := (p_patch->>'sort_order')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'invalid_sort_order' using errcode = '23514';
    end;
    if v_sort_order < 0 or v_sort_order > 100000 then
      raise exception 'invalid_sort_order' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'status' then
    v_status := lower(btrim(coalesce(p_patch->>'status', '')));
    if v_status not in ('active', 'inactive') then
      raise exception 'invalid_setting_status' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'meta' and jsonb_typeof(p_patch->'meta') <> 'object' then
    raise exception 'invalid_meta' using errcode = '23514';
  end if;

  begin
    update public.mcp_setting_items
       set item_key = case when p_patch ? 'item_key' then v_item_key else v_item.item_key end,
           label = case when p_patch ? 'label' then v_label else v_item.label end,
           value = case when p_patch ? 'value' then nullif(btrim(coalesce(p_patch->>'value', '')), '') else v_item.value end,
           category = case when p_patch ? 'category' then nullif(btrim(coalesce(p_patch->>'category', '')), '') else v_item.category end,
           brand_name = case when p_patch ? 'brand_name' then nullif(btrim(coalesce(p_patch->>'brand_name', '')), '') else v_item.brand_name end,
           product_id = case when p_patch ? 'product_id' then nullif(btrim(coalesce(p_patch->>'product_id', '')), '') else v_item.product_id end,
           sort_order = case when p_patch ? 'sort_order' then v_sort_order else v_item.sort_order end,
           status = case when p_patch ? 'status' then v_status else v_item.status end,
           raw_payload = coalesce(v_item.raw_payload, '{}'::jsonb)
             || case when p_patch ? 'meta' then p_patch->'meta' else '{}'::jsonb end
             || jsonb_build_object('foundation_context', coalesce(p_context, '{}'::jsonb)),
           updated_at = now()
     where id = v_item.id
     returning * into v_item;
  exception
    when unique_violation then
      raise exception 'report_setting_item_key_conflict' using errcode = '23505';
    when foreign_key_violation then
      raise exception 'report_setting_product_not_found' using errcode = '23503';
  end;

  return to_jsonb(v_item);
end;
$function$;

revoke all on function public.mcp_create_report_setting_group(text, text, text, text, integer, text, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.mcp_update_report_setting_group(text, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.mcp_create_report_setting_item(text, text, text, text, text, text, text, integer, text, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.mcp_update_report_setting_item(text, jsonb, jsonb)
from public, anon, authenticated;

grant execute on function public.mcp_create_report_setting_group(text, text, text, text, integer, text, jsonb, jsonb)
to service_role;
grant execute on function public.mcp_update_report_setting_group(text, jsonb, jsonb)
to service_role;
grant execute on function public.mcp_create_report_setting_item(text, text, text, text, text, text, text, integer, text, jsonb, jsonb)
to service_role;
grant execute on function public.mcp_update_report_setting_item(text, jsonb, jsonb)
to service_role;
