-- MCP Gate 5 A2: visit_date must follow the MCP session date.
-- This prevents backend or edge functions from writing the server date into historical/future sessions.

create or replace function public.mcp_visits_set_session_date()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.session_id is not null then
    select s.session_date
      into new.visit_date
      from public.mcp_route_sessions s
     where s.id = new.session_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mcp_visits_set_session_date on public.mcp_visits;

create trigger trg_mcp_visits_set_session_date
before insert or update of session_id, visit_date
on public.mcp_visits
for each row
execute function public.mcp_visits_set_session_date();

update public.mcp_visits v
   set visit_date = s.session_date
  from public.mcp_route_sessions s
 where v.session_id = s.id
   and v.visit_date is distinct from s.session_date;
