-- MCP Gate 5 A5: standardize route session counters.
-- Source of truth:
-- - planned_customers: count mcp_session_customers rows in session.
-- - visited_customers: count mcp_session_customers rows where visit_status = visited.
-- - order_count/test_count/report_count: count mcp_visits rows with matching boolean flags.
-- - followup_count: count open mcp_followups rows in session.

alter table public.mcp_route_sessions
  add column if not exists followup_count integer not null default 0;

create or replace function public.mcp_recalc_session_customer_followup_count(p_session_customer_id text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_session_customer_id is null then
    return;
  end if;

  update public.mcp_session_customers sc
     set followup_count = (
           select count(*)::integer
             from public.mcp_followups f
            where f.session_customer_id = p_session_customer_id
              and coalesce(f.status, 'open') = 'open'
         ),
         updated_at = now()
   where sc.id = p_session_customer_id;
end;
$$;

create or replace function public.mcp_recalc_route_session_counters(p_session_id text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_session_id is null then
    return;
  end if;

  update public.mcp_route_sessions s
     set planned_customers = (
           select count(*)::integer
             from public.mcp_session_customers sc
            where sc.session_id = p_session_id
         ),
         visited_customers = (
           select count(*)::integer
             from public.mcp_session_customers sc
            where sc.session_id = p_session_id
              and sc.visit_status = 'visited'
         ),
         order_count = (
           select count(*)::integer
             from public.mcp_visits v
            where v.session_id = p_session_id
              and v.has_order is true
         ),
         test_count = (
           select count(*)::integer
             from public.mcp_visits v
            where v.session_id = p_session_id
              and v.has_test is true
         ),
         report_count = (
           select count(*)::integer
             from public.mcp_visits v
            where v.session_id = p_session_id
              and v.has_report is true
         ),
         followup_count = (
           select count(*)::integer
             from public.mcp_followups f
            where f.session_id = p_session_id
              and coalesce(f.status, 'open') = 'open'
         ),
         updated_at = now()
   where s.id = p_session_id;
end;
$$;

create or replace function public.mcp_recalc_after_session_customer_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.mcp_recalc_route_session_counters(coalesce(new.session_id, old.session_id));
  if tg_op = 'UPDATE' and old.session_id is distinct from new.session_id then
    perform public.mcp_recalc_route_session_counters(old.session_id);
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.mcp_recalc_after_visit_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.mcp_recalc_route_session_counters(coalesce(new.session_id, old.session_id));
  if tg_op = 'UPDATE' and old.session_id is distinct from new.session_id then
    perform public.mcp_recalc_route_session_counters(old.session_id);
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.mcp_recalc_after_followup_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.mcp_recalc_session_customer_followup_count(coalesce(new.session_customer_id, old.session_customer_id));
  if tg_op = 'UPDATE' and old.session_customer_id is distinct from new.session_customer_id then
    perform public.mcp_recalc_session_customer_followup_count(old.session_customer_id);
  end if;

  perform public.mcp_recalc_route_session_counters(coalesce(new.session_id, old.session_id));
  if tg_op = 'UPDATE' and old.session_id is distinct from new.session_id then
    perform public.mcp_recalc_route_session_counters(old.session_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_mcp_session_customers_recalc_counters on public.mcp_session_customers;
create trigger trg_mcp_session_customers_recalc_counters
after insert or update of session_id, visit_status, order_id, test_id, report_id, followup_count or delete
on public.mcp_session_customers
for each row
execute function public.mcp_recalc_after_session_customer_change();

drop trigger if exists trg_mcp_visits_recalc_counters on public.mcp_visits;
create trigger trg_mcp_visits_recalc_counters
after insert or update of session_id, has_order, has_test, has_report, order_id, test_id, report_id or delete
on public.mcp_visits
for each row
execute function public.mcp_recalc_after_visit_change();

drop trigger if exists trg_mcp_followups_recalc_counters on public.mcp_followups;
create trigger trg_mcp_followups_recalc_counters
after insert or update of session_id, session_customer_id, status or delete
on public.mcp_followups
for each row
execute function public.mcp_recalc_after_followup_change();

do $$
declare
  r record;
begin
  for r in select id from public.mcp_session_customers loop
    perform public.mcp_recalc_session_customer_followup_count(r.id);
  end loop;

  for r in select id from public.mcp_route_sessions loop
    perform public.mcp_recalc_route_session_counters(r.id);
  end loop;
end $$;
