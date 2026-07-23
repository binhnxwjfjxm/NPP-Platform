create extension if not exists pgcrypto with schema extensions;

create table if not exists public.mcp_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  installation_id text not null,
  npp_code text,
  operation text not null,
  http_method text not null,
  route text not null,
  action text not null,
  aggregate_type text not null,
  aggregate_id text,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'processing',
  original_request_id text not null,
  last_request_id text not null,
  actor_id text,
  actor_type text,
  actor_authentication text,
  first_received_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  attempt_count integer not null default 1,
  response_status integer,
  response_payload jsonb,
  completed_at timestamptz,
  expires_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mcp_idempotency_records_status_check
    check (status in ('processing', 'completed', 'failed')),
  constraint mcp_idempotency_records_request_hash_check
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint mcp_idempotency_records_attempt_count_check
    check (attempt_count > 0),
  constraint mcp_idempotency_records_key_uidx
    unique (installation_id, operation, idempotency_key)
);

create index if not exists mcp_idempotency_records_status_lease_idx
  on public.mcp_idempotency_records (status, locked_until);

create index if not exists mcp_idempotency_records_expires_at_idx
  on public.mcp_idempotency_records (expires_at)
  where expires_at is not null;

create index if not exists mcp_idempotency_records_request_id_idx
  on public.mcp_idempotency_records (original_request_id);

create table if not exists public.mcp_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  schema_version text not null default 'mcp.audit.v1',
  installation_id text not null,
  npp_code text,
  actor_id text,
  actor_type text,
  actor_authentication text,
  request_id text not null,
  idempotency_key text,
  operation text not null,
  http_method text not null,
  route text not null,
  aggregate_type text not null,
  aggregate_id text,
  action text not null,
  outcome text not null,
  status_code integer not null,
  request_hash text,
  before_hash text,
  after_hash text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  constraint mcp_audit_events_outcome_check
    check (outcome in ('succeeded', 'rejected', 'failed', 'replayed')),
  constraint mcp_audit_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists mcp_audit_events_request_id_idx
  on public.mcp_audit_events (request_id);

create index if not exists mcp_audit_events_operation_time_idx
  on public.mcp_audit_events (operation, occurred_at desc);

create index if not exists mcp_audit_events_aggregate_idx
  on public.mcp_audit_events (aggregate_type, aggregate_id, occurred_at desc);

create index if not exists mcp_audit_events_idempotency_idx
  on public.mcp_audit_events (installation_id, operation, idempotency_key)
  where idempotency_key is not null;

alter table public.mcp_idempotency_records enable row level security;
alter table public.mcp_audit_events enable row level security;

revoke select, insert, update, delete, truncate, references, trigger on table public.mcp_idempotency_records from public, anon, authenticated;
revoke select, insert, update, delete, truncate, references, trigger on table public.mcp_audit_events from public, anon, authenticated;

grant select on table public.mcp_idempotency_records to service_role;
grant select on table public.mcp_audit_events to service_role;

create or replace function public.mcp_reject_audit_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  raise exception 'audit_events_append_only' using errcode = '55000';
end;
$function$;

drop trigger if exists mcp_audit_events_append_only on public.mcp_audit_events;
create trigger mcp_audit_events_append_only
before update or delete on public.mcp_audit_events
for each row execute function public.mcp_reject_audit_event_mutation();

create or replace function public.mcp_idempotency_request_hash(
  p_operation text,
  p_payload jsonb
)
returns text
language sql
immutable
strict
set search_path = public
as $function$
  select encode(
    extensions.digest(
      convert_to(trim(p_operation) || E'\n' || coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$function$;

create or replace function public.mcp_append_audit_event(
  p_installation_id text,
  p_npp_code text,
  p_actor_id text,
  p_actor_type text,
  p_actor_authentication text,
  p_request_id text,
  p_idempotency_key text,
  p_operation text,
  p_http_method text,
  p_route text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_action text,
  p_outcome text,
  p_status_code integer,
  p_request_hash text,
  p_before_hash text,
  p_after_hash text,
  p_error_code text,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if nullif(btrim(coalesce(p_installation_id, '')), '') is null then
    raise exception 'installation_id_required' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_request_id, '')), '') is null then
    raise exception 'request_id_required' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_operation, '')), '') is null then
    raise exception 'operation_required' using errcode = '23514';
  end if;
  if p_outcome not in ('succeeded', 'rejected', 'failed', 'replayed') then
    raise exception 'invalid_audit_outcome' using errcode = '23514';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'invalid_audit_metadata' using errcode = '23514';
  end if;

  insert into public.mcp_audit_events (
    installation_id,
    npp_code,
    actor_id,
    actor_type,
    actor_authentication,
    request_id,
    idempotency_key,
    operation,
    http_method,
    route,
    aggregate_type,
    aggregate_id,
    action,
    outcome,
    status_code,
    request_hash,
    before_hash,
    after_hash,
    error_code,
    metadata
  ) values (
    btrim(p_installation_id),
    nullif(btrim(coalesce(p_npp_code, '')), ''),
    nullif(btrim(coalesce(p_actor_id, '')), ''),
    nullif(btrim(coalesce(p_actor_type, '')), ''),
    nullif(btrim(coalesce(p_actor_authentication, '')), ''),
    btrim(p_request_id),
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    btrim(p_operation),
    upper(btrim(coalesce(p_http_method, 'POST'))),
    btrim(coalesce(p_route, '')),
    btrim(coalesce(p_aggregate_type, 'unknown')),
    nullif(btrim(coalesce(p_aggregate_id, '')), ''),
    btrim(coalesce(p_action, 'mutation')),
    p_outcome,
    p_status_code,
    p_request_hash,
    p_before_hash,
    p_after_hash,
    nullif(btrim(coalesce(p_error_code, '')), ''),
    v_metadata
  ) returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.mcp_idempotency_begin(
  p_operation text,
  p_http_method text,
  p_route text,
  p_action text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_payload jsonb,
  p_context jsonb,
  p_lease_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_installation_id text;
  v_npp_code text;
  v_request_id text;
  v_actor_id text;
  v_actor_type text;
  v_actor_authentication text;
  v_key text;
  v_hash text;
  v_record public.mcp_idempotency_records%rowtype;
  v_lease integer := greatest(5, least(coalesce(p_lease_seconds, 30), 300));
  v_retry_after integer;
begin
  if jsonb_typeof(v_context) <> 'object' then
    raise exception 'invalid_context' using errcode = '23514';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'invalid_idempotency_payload' using errcode = '23514';
  end if;

  v_installation_id := nullif(btrim(coalesce(v_context ->> 'installationId', '')), '');
  v_npp_code := nullif(btrim(coalesce(v_context ->> 'nppCode', '')), '');
  v_request_id := nullif(btrim(coalesce(v_context ->> 'requestId', '')), '');
  v_actor_id := nullif(btrim(coalesce(v_context ->> 'actorId', '')), '');
  v_actor_type := nullif(btrim(coalesce(v_context ->> 'actorType', '')), '');
  v_actor_authentication := nullif(btrim(coalesce(v_context ->> 'actorAuthentication', '')), '');
  v_key := nullif(btrim(coalesce(v_context ->> 'idempotencyKey', '')), '');

  if v_installation_id is null then
    raise exception 'installation_id_required' using errcode = '23514';
  end if;
  if v_request_id is null then
    raise exception 'request_id_required' using errcode = '23514';
  end if;
  if v_key is null then
    raise exception 'idempotency_key_required' using errcode = '23514';
  end if;
  if length(v_key) > 192 or v_key !~ '^[A-Za-z0-9][A-Za-z0-9._:~+\-]{7,191}$' then
    raise exception 'invalid_idempotency_key' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_operation, '')), '') is null then
    raise exception 'operation_required' using errcode = '23514';
  end if;

  v_hash := public.mcp_idempotency_request_hash(p_operation, v_payload);

  begin
    perform set_config('lock_timeout', '2000ms', true);

    insert into public.mcp_idempotency_records (
      installation_id,
      npp_code,
      operation,
      http_method,
      route,
      action,
      aggregate_type,
      aggregate_id,
      idempotency_key,
      request_hash,
      status,
      original_request_id,
      last_request_id,
      actor_id,
      actor_type,
      actor_authentication,
      first_received_at,
      last_attempt_at,
      locked_until,
      attempt_count
    ) values (
      v_installation_id,
      v_npp_code,
      btrim(p_operation),
      upper(btrim(coalesce(p_http_method, 'POST'))),
      btrim(coalesce(p_route, '')),
      btrim(coalesce(p_action, 'mutation')),
      btrim(coalesce(p_aggregate_type, 'unknown')),
      nullif(btrim(coalesce(p_aggregate_id, '')), ''),
      v_key,
      v_hash,
      'processing',
      v_request_id,
      v_request_id,
      v_actor_id,
      v_actor_type,
      v_actor_authentication,
      now(),
      now(),
      now() + make_interval(secs => v_lease),
      1
    )
    on conflict (installation_id, operation, idempotency_key) do nothing
    returning * into v_record;

    perform set_config('lock_timeout', '0', true);
  exception
    when lock_not_available then
      perform set_config('lock_timeout', '0', true);
      raise exception 'idempotency_in_progress'
        using errcode = '55P03', detail = '2';
  end;

  if v_record.id is not null then
    return jsonb_build_object(
      'mode', 'execute',
      'recordId', v_record.id,
      'requestHash', v_hash,
      'originalRequestId', v_request_id
    );
  end if;

  begin
    perform set_config('lock_timeout', '2000ms', true);

    select *
      into v_record
      from public.mcp_idempotency_records
     where installation_id = v_installation_id
       and operation = btrim(p_operation)
       and idempotency_key = v_key
     for update;

    perform set_config('lock_timeout', '0', true);
  exception
    when lock_not_available then
      perform set_config('lock_timeout', '0', true);
      raise exception 'idempotency_in_progress'
        using errcode = '55P03', detail = '2';
  end;

  if v_record.id is null then
    raise exception 'idempotency_record_not_found' using errcode = 'P0002';
  end if;

  if v_record.request_hash <> v_hash then
    raise exception 'idempotency_key_conflict' using errcode = '23514';
  end if;

  if v_record.status = 'completed' then
    update public.mcp_idempotency_records
       set last_request_id = v_request_id,
           last_attempt_at = now(),
           attempt_count = attempt_count + 1,
           updated_at = now()
     where id = v_record.id;

    perform public.mcp_append_audit_event(
      v_installation_id,
      v_npp_code,
      v_actor_id,
      v_actor_type,
      v_actor_authentication,
      v_request_id,
      v_key,
      v_record.operation,
      v_record.http_method,
      v_record.route,
      v_record.aggregate_type,
      coalesce(v_record.aggregate_id, p_aggregate_id),
      v_record.action,
      'replayed',
      coalesce(v_record.response_status, 200),
      v_record.request_hash,
      null,
      case
        when v_record.response_payload is null then null
        else encode(extensions.digest(convert_to(v_record.response_payload::text, 'UTF8'), 'sha256'), 'hex')
      end,
      null,
      jsonb_build_object(
        'replayed', true,
        'originalRequestId', v_record.original_request_id
      )
    );

    return jsonb_build_object(
      'mode', 'replay',
      'recordId', v_record.id,
      'requestHash', v_record.request_hash,
      'responseStatus', coalesce(v_record.response_status, 200),
      'responsePayload', v_record.response_payload,
      'originalRequestId', v_record.original_request_id
    );
  end if;

  if v_record.status = 'processing' and v_record.locked_until is not null and v_record.locked_until > now() then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_record.locked_until - now())))::integer);
    raise exception 'idempotency_in_progress'
      using errcode = '55P03', detail = v_retry_after::text;
  end if;

  update public.mcp_idempotency_records
     set status = 'processing',
         last_request_id = v_request_id,
         actor_id = v_actor_id,
         actor_type = v_actor_type,
         actor_authentication = v_actor_authentication,
         last_attempt_at = now(),
         locked_until = now() + make_interval(secs => v_lease),
         attempt_count = attempt_count + 1,
         response_status = null,
         response_payload = null,
         completed_at = null,
         expires_at = null,
         error_code = null,
         updated_at = now()
   where id = v_record.id
   returning * into v_record;

  return jsonb_build_object(
    'mode', 'execute',
    'recordId', v_record.id,
    'requestHash', v_record.request_hash,
    'originalRequestId', v_record.original_request_id
  );
end;
$function$;

create or replace function public.mcp_idempotency_complete(
  p_record_id uuid,
  p_response_status integer,
  p_response_payload jsonb,
  p_aggregate_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_record public.mcp_idempotency_records%rowtype;
  v_payload jsonb := p_response_payload;
  v_after_hash text;
  v_aggregate_id text := nullif(btrim(coalesce(p_aggregate_id, '')), '');
begin
  if p_record_id is null then
    raise exception 'idempotency_record_id_required' using errcode = '23514';
  end if;
  if p_response_status < 200 or p_response_status > 299 then
    raise exception 'invalid_idempotency_response_status' using errcode = '23514';
  end if;
  if v_payload is not null and octet_length(v_payload::text) > 2097152 then
    raise exception 'idempotency_response_too_large' using errcode = '54000';
  end if;

  select *
    into v_record
    from public.mcp_idempotency_records
   where id = p_record_id
   for update;

  if not found then
    raise exception 'idempotency_record_not_found' using errcode = 'P0002';
  end if;
  if v_record.status <> 'processing' then
    raise exception 'idempotency_record_not_processing' using errcode = '55000';
  end if;

  if v_payload is not null then
    v_after_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  end if;

  update public.mcp_idempotency_records
     set status = 'completed',
         aggregate_id = coalesce(v_aggregate_id, aggregate_id),
         response_status = p_response_status,
         response_payload = v_payload,
         completed_at = now(),
         expires_at = now() + interval '30 days',
         locked_until = null,
         error_code = null,
         updated_at = now()
   where id = v_record.id
   returning * into v_record;

  perform public.mcp_append_audit_event(
    v_record.installation_id,
    v_record.npp_code,
    v_record.actor_id,
    v_record.actor_type,
    v_record.actor_authentication,
    v_record.last_request_id,
    v_record.idempotency_key,
    v_record.operation,
    v_record.http_method,
    v_record.route,
    v_record.aggregate_type,
    v_record.aggregate_id,
    v_record.action,
    'succeeded',
    p_response_status,
    v_record.request_hash,
    null,
    v_after_hash,
    null,
    jsonb_build_object('replayed', false)
  );

  return jsonb_build_object(
    'data', v_payload,
    'meta', jsonb_build_object(
      'idempotency', jsonb_build_object(
        'replayed', false,
        'originalRequestId', v_record.original_request_id
      )
    )
  );
end;
$function$;

revoke execute on function public.mcp_reject_audit_event_mutation() from public, anon, authenticated, service_role;
revoke execute on function public.mcp_idempotency_request_hash(text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.mcp_append_audit_event(text, text, text, text, text, text, text, text, text, text, text, text, text, text, integer, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.mcp_idempotency_begin(text, text, text, text, text, text, jsonb, jsonb, integer) from public, anon, authenticated, service_role;
revoke execute on function public.mcp_idempotency_complete(uuid, integer, jsonb, text) from public, anon, authenticated, service_role;
