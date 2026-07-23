create or replace function public.mcp_delete_empty_route_session(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  sess public.mcp_route_sessions%rowtype;
  v_snapshot_count integer := 0;
  v_snapshot_activity_count integer := 0;
  v_visit_count integer := 0;
  v_followup_count integer := 0;
  v_report_count integer := 0;
  v_snapshot_deleted integer := 0;
  v_visit_deleted integer := 0;
  v_session_deleted integer := 0;
begin
  if nullif(trim(p_session_id), '') is null then
    raise exception 'session_id_required' using errcode = '23514';
  end if;

  select *
    into sess
    from public.mcp_route_sessions
   where id = p_session_id
   for update;

  if not found then
    raise exception 'session_not_found' using errcode = '23503';
  end if;

  if lower(coalesce(sess.status, '')) in ('done', 'completed') then
    raise exception 'session_closed_cannot_delete' using errcode = '23514';
  end if;

  select
    count(*),
    count(*) filter (
      where coalesce(visit_status, 'pending') <> 'pending'
         or visit_id is not null
         or order_id is not null
         or test_id is not null
         or report_id is not null
         or coalesce(followup_count, 0) > 0
    )
    into v_snapshot_count, v_snapshot_activity_count
    from public.mcp_session_customers
   where session_id = sess.id;

  select count(*)
    into v_visit_count
    from public.mcp_visits
   where session_id = sess.id;

  select count(*)
    into v_followup_count
    from public.mcp_followups
   where session_id = sess.id;

  select count(*)
    into v_report_count
    from public.mcp_session_reports
   where session_id = sess.id;

  if v_snapshot_activity_count > 0
     or v_visit_count > 0
     or v_followup_count > 0
     or v_report_count > 0
     or coalesce(sess.visited_customers, 0) > 0
     or coalesce(sess.order_count, 0) > 0
     or coalesce(sess.test_count, 0) > 0
     or coalesce(sess.report_count, 0) > 0
     or coalesce(sess.followup_count, 0) > 0
  then
    raise exception 'session_has_activity_cancel_instead'
      using errcode = '23514',
            detail = jsonb_build_object(
              'snapshotActivityCount', v_snapshot_activity_count,
              'visitCount', v_visit_count,
              'followupCount', v_followup_count,
              'reportCount', v_report_count,
              'orderCount', coalesce(sess.order_count, 0),
              'testCount', coalesce(sess.test_count, 0)
            )::text;
  end if;

  delete from public.mcp_visits
   where session_id = sess.id;
  get diagnostics v_visit_deleted = row_count;

  delete from public.mcp_session_customers
   where session_id = sess.id;
  get diagnostics v_snapshot_deleted = row_count;

  delete from public.mcp_route_sessions
   where id = sess.id;
  get diagnostics v_session_deleted = row_count;

  if v_session_deleted <> 1 then
    raise exception 'session_delete_not_applied' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'id', sess.id,
    'deleted', true,
    'snapshotCount', v_snapshot_count,
    'snapshotDeleted', v_snapshot_deleted,
    'visitDeleted', v_visit_deleted
  );
end;
$function$;

revoke all on function public.mcp_delete_empty_route_session(text)
from public, anon, authenticated;

grant execute on function public.mcp_delete_empty_route_session(text)
to service_role;
