create or replace function public.mcp_save_session_report_ai_result(
  p_session_id text,
  p_ai_result jsonb,
  p_analyzed_at timestamptz default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_report public.mcp_session_reports%rowtype;
  v_analyzed_at timestamptz := coalesce(p_analyzed_at, now());
begin
  if nullif(btrim(coalesce(p_session_id, '')), '') is null then
    raise exception 'session_id_required' using errcode = '23514';
  end if;

  if p_ai_result is null then
    raise exception 'ai_result_required' using errcode = '23514';
  end if;

  if jsonb_typeof(p_ai_result) <> 'object' then
    raise exception 'invalid_ai_result' using errcode = '23514';
  end if;

  select *
    into v_report
    from public.mcp_session_reports
   where session_id = p_session_id
   for update;

  if not found then
    raise exception 'session_report_not_found' using errcode = '23503';
  end if;

  update public.mcp_session_reports
     set ai_result = p_ai_result,
         ai_analyzed_at = v_analyzed_at,
         raw_payload = jsonb_set(
           coalesce(raw_payload, '{}'::jsonb),
           '{aiResultContext}',
           coalesce(p_context, '{}'::jsonb),
           true
         ),
         updated_at = v_analyzed_at
   where id = v_report.id
   returning * into v_report;

  return jsonb_build_object(
    'row', to_jsonb(v_report),
    'analyzedAt', v_analyzed_at
  );
end;
$function$;

revoke all on function public.mcp_save_session_report_ai_result(text, jsonb, timestamptz, jsonb)
from public, anon, authenticated;

grant execute on function public.mcp_save_session_report_ai_result(text, jsonb, timestamptz, jsonb)
to service_role;
