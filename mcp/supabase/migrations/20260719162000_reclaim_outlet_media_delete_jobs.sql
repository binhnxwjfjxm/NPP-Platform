drop function if exists public.mcp_claim_ready_storage_delete_jobs(text, integer, jsonb);

create or replace function public.mcp_claim_ready_storage_delete_jobs(
  p_installation_id text,
  p_retry_before timestamptz,
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
  if p_retry_before is null then
    raise exception 'retry_before_required' using errcode = '23514';
  end if;

  with candidates as (
    select job.id
      from public.mcp_storage_delete_jobs job
     where job.installation_id = p_installation_id
       and (
         job.status in ('pending', 'failed')
         or (job.status = 'finalizing' and job.updated_at < p_retry_before)
       )
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

revoke all on function public.mcp_claim_ready_storage_delete_jobs(text, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_claim_ready_storage_delete_jobs(text, timestamptz, integer, jsonb)
  to service_role;
