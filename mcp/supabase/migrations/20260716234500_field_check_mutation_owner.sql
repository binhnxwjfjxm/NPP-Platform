create or replace function public.mcp_update_field_check_result(
  p_result_id text,
  p_product_id text,
  p_product_name text,
  p_status text,
  p_note text,
  p_session_customer_id text,
  p_input_meta jsonb,
  p_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_existing public.test_customer_results%rowtype;
  v_updated public.test_customer_results%rowtype;
  v_product_name text;
  v_status text;
  v_input_meta jsonb;
begin
  if p_result_id is null or length(trim(p_result_id)) = 0 then
    raise exception 'result_id_required' using errcode = '23514';
  end if;

  v_product_name := nullif(trim(coalesce(p_product_name, '')), '');
  if v_product_name is null then
    raise exception 'product_name_required' using errcode = '23514';
  end if;
  if length(v_product_name) > 500 then
    raise exception 'invalid_product_name' using errcode = '23514';
  end if;

  v_status := lower(trim(coalesce(p_status, '')));
  if v_status not in ('ok', 'interested', 'bad') then
    raise exception 'invalid_field_check_status' using errcode = '23514';
  end if;

  if p_note is not null and length(p_note) > 5000 then
    raise exception 'invalid_note' using errcode = '23514';
  end if;

  if p_product_id is not null and length(p_product_id) > 200 then
    raise exception 'invalid_product_id' using errcode = '23514';
  end if;

  select *
    into v_existing
    from public.test_customer_results
   where id = trim(p_result_id)
     and deleted_at is null
   for update;

  if v_existing.id is null then
    raise exception 'field_check_result_not_found' using errcode = 'P0002';
  end if;

  if p_session_customer_id is not null
     and length(trim(p_session_customer_id)) > 0
     and not exists (
       select 1
         from public.mcp_session_customers sc
        where sc.id = trim(p_session_customer_id)
          and (
            sc.test_id = v_existing.id
            or v_existing.raw_payload ->> 'session_customer_id' = sc.id
          )
     ) then
    raise exception 'field_check_session_customer_mismatch' using errcode = '23514';
  end if;

  v_input_meta := jsonb_strip_nulls(coalesce(p_input_meta, '{}'::jsonb));

  update public.test_customer_results
     set product_id = nullif(trim(coalesce(p_product_id, '')), ''),
         product_name = v_product_name,
         status = v_status,
         note = nullif(trim(coalesce(p_note, '')), ''),
         sync_status = 'pending',
         raw_payload = coalesce(v_existing.raw_payload, '{}'::jsonb)
           || jsonb_build_object(
             'field_check_update', v_input_meta,
             'foundation_context', coalesce(p_context, '{}'::jsonb)
           ),
         updated_at = now()
   where id = v_existing.id
   returning * into v_updated;

  return to_jsonb(v_updated);
end;
$function$;

revoke execute on function public.mcp_update_field_check_result(text, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_update_field_check_result(text, text, text, text, text, text, jsonb, jsonb) to service_role;
