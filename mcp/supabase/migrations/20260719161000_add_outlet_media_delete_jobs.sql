create table if not exists public.mcp_storage_delete_jobs (
  id text primary key,
  installation_id text not null,
  target_type text not null check (target_type in ('route_customer', 'route')),
  target_id text not null,
  status text not null default 'pending' check (status in ('pending', 'finalizing', 'failed', 'completed')),
  requested_by text,
  attempt_count integer not null default 0,
  last_error text,
  raw_payload jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (installation_id, target_type, target_id)
);

create index if not exists mcp_storage_delete_jobs_ready_idx
  on public.mcp_storage_delete_jobs(installation_id, status, updated_at)
  where status in ('pending', 'failed');

revoke all on table public.mcp_storage_delete_jobs from public, anon, authenticated;
grant select, insert, update on table public.mcp_storage_delete_jobs to service_role;

create or replace function public.mcp_claim_route_customer_media_delete(
  p_installation_id text,
  p_route_customer_id text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_route_customer public.mcp_route_customers%rowtype;
  v_job public.mcp_storage_delete_jobs%rowtype;
  v_media jsonb := '[]'::jsonb;
begin
  if nullif(btrim(coalesce(p_installation_id, '')), '') is null then
    raise exception 'installation_id_required' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_route_customer_id, '')), '') is null then
    raise exception 'route_customer_id_required' using errcode = '23514';
  end if;

  select * into v_route_customer
    from public.mcp_route_customers
   where id = p_route_customer_id
   for update;

  if not found then
    raise exception 'route_customer_not_found' using errcode = '23503';
  end if;

  insert into public.mcp_storage_delete_jobs (
    id, installation_id, target_type, target_id, status, requested_by, raw_payload
  ) values (
    'msdj_' || replace(gen_random_uuid()::text, '-', ''),
    p_installation_id,
    'route_customer',
    v_route_customer.id,
    'pending',
    nullif(btrim(coalesce(p_context ->> 'actorId', '')), ''),
    jsonb_build_object('request_context', coalesce(p_context, '{}'::jsonb))
  )
  on conflict (installation_id, target_type, target_id)
  do update set
    status = case when public.mcp_storage_delete_jobs.status = 'completed' then 'completed' else 'pending' end,
    requested_by = excluded.requested_by,
    last_error = null,
    raw_payload = coalesce(public.mcp_storage_delete_jobs.raw_payload, '{}'::jsonb) || excluded.raw_payload,
    updated_at = now()
  returning * into v_job;

  update public.mcp_route_customers
     set active = false,
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'hard_delete_job_id', v_job.id,
           'hard_delete_requested_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = now()
   where id = v_route_customer.id
   returning * into v_route_customer;

  update public.mcp_outlet_media
     set status = 'deleting',
         delete_requested_at = coalesce(delete_requested_at, now()),
         delete_attempt_count = delete_attempt_count + 1,
         last_delete_error = null,
         updated_at = now()
   where installation_id = p_installation_id
     and route_customer_id = v_route_customer.id
     and status <> 'deleted';

  select coalesce(jsonb_agg(to_jsonb(media) order by media.created_at), '[]'::jsonb)
    into v_media
    from public.mcp_outlet_media media
   where media.installation_id = p_installation_id
     and media.route_customer_id = v_route_customer.id
     and media.status <> 'deleted';

  return jsonb_build_object(
    'deleteJob', to_jsonb(v_job),
    'routeCustomer', to_jsonb(v_route_customer),
    'media', v_media
  );
end;
$function$;

create or replace function public.mcp_claim_route_media_delete(
  p_installation_id text,
  p_route_id text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_route public.mcp_routes%rowtype;
  v_job public.mcp_storage_delete_jobs%rowtype;
  v_media jsonb := '[]'::jsonb;
begin
  if nullif(btrim(coalesce(p_installation_id, '')), '') is null then
    raise exception 'installation_id_required' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_route_id, '')), '') is null then
    raise exception 'route_id_required' using errcode = '23514';
  end if;

  select * into v_route
    from public.mcp_routes
   where id = p_route_id
   for update;

  if not found then
    raise exception 'route_not_found' using errcode = '23503';
  end if;

  insert into public.mcp_storage_delete_jobs (
    id, installation_id, target_type, target_id, status, requested_by, raw_payload
  ) values (
    'msdj_' || replace(gen_random_uuid()::text, '-', ''),
    p_installation_id,
    'route',
    v_route.id,
    'pending',
    nullif(btrim(coalesce(p_context ->> 'actorId', '')), ''),
    jsonb_build_object('request_context', coalesce(p_context, '{}'::jsonb))
  )
  on conflict (installation_id, target_type, target_id)
  do update set
    status = case when public.mcp_storage_delete_jobs.status = 'completed' then 'completed' else 'pending' end,
    requested_by = excluded.requested_by,
    last_error = null,
    raw_payload = coalesce(public.mcp_storage_delete_jobs.raw_payload, '{}'::jsonb) || excluded.raw_payload,
    updated_at = now()
  returning * into v_job;

  update public.mcp_routes
     set active = false,
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'hard_delete_job_id', v_job.id,
           'hard_delete_requested_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = now()
   where id = v_route.id
   returning * into v_route;

  update public.mcp_route_customers
     set active = false,
         updated_at = now()
   where route_id = v_route.id;

  update public.mcp_outlet_media media
     set status = 'deleting',
         delete_requested_at = coalesce(media.delete_requested_at, now()),
         delete_attempt_count = media.delete_attempt_count + 1,
         last_delete_error = null,
         updated_at = now()
   where media.installation_id = p_installation_id
     and media.route_customer_id in (
       select route_customer.id
         from public.mcp_route_customers route_customer
        where route_customer.route_id = v_route.id
     )
     and media.status <> 'deleted';

  select coalesce(jsonb_agg(to_jsonb(media) order by media.created_at), '[]'::jsonb)
    into v_media
    from public.mcp_outlet_media media
    join public.mcp_route_customers route_customer
      on route_customer.id = media.route_customer_id
   where media.installation_id = p_installation_id
     and route_customer.route_id = v_route.id
     and media.status <> 'deleted';

  return jsonb_build_object(
    'deleteJob', to_jsonb(v_job),
    'route', to_jsonb(v_route),
    'media', v_media
  );
end;
$function$;

create or replace function public.mcp_claim_ready_storage_delete_jobs(
  p_installation_id text,
  p_limit integer default 20,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
begin
  if nullif(btrim(coalesce(p_installation_id, '')), '') is null then
    raise exception 'installation_id_required' using errcode = '23514';
  end if;

  with candidates as (
    select job.id
      from public.mcp_storage_delete_jobs job
     where job.installation_id = p_installation_id
       and job.status in ('pending', 'failed')
       and (
         (
           job.target_type = 'route_customer'
           and not exists (
             select 1
               from public.mcp_outlet_media media
              where media.installation_id = job.installation_id
                and media.route_customer_id = job.target_id
                and media.status <> 'deleted'
           )
         )
         or
         (
           job.target_type = 'route'
           and not exists (
             select 1
               from public.mcp_outlet_media media
               join public.mcp_route_customers route_customer
                 on route_customer.id = media.route_customer_id
              where media.installation_id = job.installation_id
                and route_customer.route_id = job.target_id
                and media.status <> 'deleted'
           )
         )
       )
     order by job.requested_at
     for update skip locked
     limit v_limit
  ), claimed as (
    update public.mcp_storage_delete_jobs job
       set status = 'finalizing',
           attempt_count = job.attempt_count + 1,
           last_error = null,
           raw_payload = coalesce(job.raw_payload, '{}'::jsonb) || jsonb_build_object(
             'finalize_claim_context', coalesce(p_context, '{}'::jsonb)
           ),
           updated_at = now()
      from candidates
     where job.id = candidates.id
     returning job.*
  )
  select coalesce(jsonb_agg(to_jsonb(claimed) order by claimed.requested_at), '[]'::jsonb)
    into v_jobs
    from claimed;

  return v_jobs;
end;
$function$;

create or replace function public.mcp_finish_storage_delete_job(
  p_installation_id text,
  p_job_id text,
  p_succeeded boolean,
  p_error text default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_job public.mcp_storage_delete_jobs%rowtype;
begin
  if nullif(btrim(coalesce(p_installation_id, '')), '') is null then
    raise exception 'installation_id_required' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_job_id, '')), '') is null then
    raise exception 'delete_job_id_required' using errcode = '23514';
  end if;

  select * into v_job
    from public.mcp_storage_delete_jobs
   where installation_id = p_installation_id
     and id = p_job_id
   for update;

  if not found then
    raise exception 'storage_delete_job_not_found' using errcode = '23503';
  end if;

  update public.mcp_storage_delete_jobs
     set status = case when coalesce(p_succeeded, false) then 'completed' else 'failed' end,
         completed_at = case when coalesce(p_succeeded, false) then now() else null end,
         last_error = case
           when coalesce(p_succeeded, false) then null
           else left(coalesce(nullif(btrim(p_error), ''), 'storage_parent_delete_failed'), 500)
         end,
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
           'finish_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = now()
   where id = v_job.id
   returning * into v_job;

  return to_jsonb(v_job);
end;
$function$;

revoke all on function public.mcp_claim_ready_storage_delete_jobs(text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_claim_ready_storage_delete_jobs(text, integer, jsonb)
  to service_role;

revoke all on function public.mcp_finish_storage_delete_job(text, text, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_finish_storage_delete_job(text, text, boolean, text, jsonb)
  to service_role;
