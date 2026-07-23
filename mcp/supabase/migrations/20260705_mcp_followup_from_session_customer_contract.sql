-- MCP-8 Follow-up contract: create a follow-up from a MCP session customer.
-- Inputs: title, due_date, priority, owner, note, followup_type.
-- Output: inserts mcp_followups, updates mcp_session_customers.followup_count,
-- and recalculates MCP session counters.

create or replace function public.mcp_create_followup_from_session_customer(
  p_session_customer_id text,
  p_title text,
  p_due_date date default null,
  p_priority text default 'medium',
  p_owner text default null,
  p_note text default null,
  p_followup_type text default 'general'
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  sc record;
  v_followup_id text;
  v_priority text;
  v_title text;
  v_followup_type text;
  v_count integer := 0;
  now_ts timestamptz := now();
begin
  if p_session_customer_id is null or length(trim(p_session_customer_id)) = 0 then
    raise exception 'session_customer_id_required' using errcode = '23514';
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null then
    raise exception 'followup_title_required' using errcode = '23514';
  end if;

  v_priority := lower(coalesce(nullif(trim(coalesce(p_priority, '')), ''), 'medium'));
  if v_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'invalid_priority' using errcode = '23514';
  end if;

  v_followup_type := lower(coalesce(nullif(trim(coalesce(p_followup_type, '')), ''), 'general'));

  select * into sc
    from public.mcp_session_customers
   where id = p_session_customer_id;

  if sc.id is null then
    raise exception 'session_customer_not_found' using errcode = '23503';
  end if;

  v_followup_id := 'mcf_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.mcp_followups (
    id, session_id, session_customer_id, visit_id, route_id, route_customer_id,
    customer_id, customer_name, followup_type, title, due_date, status, priority,
    owner, note, raw_payload, created_at, updated_at
  ) values (
    v_followup_id, sc.session_id, sc.id, sc.visit_id, sc.route_id, sc.route_customer_id,
    sc.customer_id, sc.customer_name, v_followup_type, v_title, p_due_date, 'open', v_priority,
    nullif(trim(coalesce(p_owner, '')), ''), nullif(trim(coalesce(p_note, '')), ''),
    jsonb_build_object('source', 'mcp_create_followup_from_session_customer', 'session_customer_id', sc.id),
    now_ts, now_ts
  );

  select count(*)::integer into v_count
    from public.mcp_followups
   where session_customer_id = sc.id
     and status = 'open';

  update public.mcp_session_customers
     set followup_count = v_count,
         updated_at = now_ts
   where id = sc.id;

  perform public.mcp_recalc_route_session_counters(sc.session_id);

  return jsonb_build_object(
    'followupId', v_followup_id,
    'sessionCustomerId', sc.id,
    'followupCount', v_count
  );
end;
$$;
