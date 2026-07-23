-- MCP Gate 5 A4: fail closed when adding session customers without explicit session context.
-- This prevents malformed write flows from silently falling back to the latest MCP session.
-- Future backend/edge code must pass the selected session id into raw_payload as one of:
-- session_id, sessionId, explicit_session_id, received_session_id.

create or replace function public.mcp_session_customers_require_added_session_context()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  payload_session_id text;
begin
  if new.source = 'added' then
    payload_session_id := coalesce(
      new.raw_payload ->> 'session_id',
      new.raw_payload ->> 'sessionId',
      new.raw_payload ->> 'explicit_session_id',
      new.raw_payload ->> 'received_session_id'
    );

    if payload_session_id is null or payload_session_id <> new.session_id then
      raise exception 'explicit_session_id_required_for_added_customer' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mcp_session_customers_require_added_session_context on public.mcp_session_customers;

create trigger trg_mcp_session_customers_require_added_session_context
before insert or update of source, session_id, raw_payload
on public.mcp_session_customers
for each row
execute function public.mcp_session_customers_require_added_session_context();
