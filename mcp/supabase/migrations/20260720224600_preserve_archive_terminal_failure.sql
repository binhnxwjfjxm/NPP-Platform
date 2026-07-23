alter function public.mcp_finish_archive_intent(text, text, boolean, integer, jsonb, text, jsonb)
  rename to mcp_finish_archive_intent_mutable;

revoke all on function public.mcp_finish_archive_intent_mutable(text, text, boolean, integer, jsonb, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.mcp_finish_archive_intent(
  p_installation_id text,
  p_intent_id text,
  p_succeeded boolean,
  p_response_status integer default null,
  p_response_payload jsonb default null,
  p_error text default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_intent public.mcp_archive_intents%rowtype;
begin
  select * into v_intent
    from public.mcp_archive_intents
   where installation_id = p_installation_id
     and id = p_intent_id
   for update;

  if not found then
    raise exception 'archive_intent_not_found' using errcode = '23503';
  end if;

  if v_intent.status = 'failed' and coalesce(p_succeeded, false) is not true then
    return to_jsonb(v_intent);
  end if;

  return public.mcp_finish_archive_intent_mutable(
    p_installation_id,
    p_intent_id,
    p_succeeded,
    p_response_status,
    p_response_payload,
    p_error,
    p_context
  );
end;
$function$;

revoke all on function public.mcp_finish_archive_intent(text, text, boolean, integer, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_finish_archive_intent(text, text, boolean, integer, jsonb, text, jsonb)
  to service_role;
