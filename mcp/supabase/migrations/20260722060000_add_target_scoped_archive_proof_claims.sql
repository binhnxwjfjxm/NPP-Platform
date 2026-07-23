create or replace function public.mcp_f05_archive_proof_capabilities(
  p_installation_id text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
begin
  if nullif(btrim(coalesce(p_installation_id, '')), '') is null then
    raise exception 'installation_id_required' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_archive_proof_capability_context' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'targetScopedMediaClaim', true,
    'targetScopedDeleteJobClaim', true,
    'broadBatchClaimsForbidden', true
  );
end;
$function$;

create or replace function public.mcp_claim_one_outlet_media_delete(
  p_installation_id text,
  p_media_id text,
  p_retry_before timestamptz,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_media public.mcp_outlet_media%rowtype;
begin
  if nullif(btrim(coalesce(p_installation_id, '')), '') is null then
    raise exception 'installation_id_required' using errcode = '23514';
  end if;
  if nullif(btrim(coalesce(p_media_id, '')), '') is null then
    raise exception 'media_id_required' using errcode = '23514';
  end if;
  if p_retry_before is null then
    raise exception 'retry_before_required' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_media_claim_context' using errcode = '23514';
  end if;

  update public.mcp_outlet_media media
     set status = 'deleting',
         delete_attempt_count = media.delete_attempt_count + 1,
         last_delete_error = null,
         raw_payload = coalesce(media.raw_payload, '{}'::jsonb) || jsonb_build_object(
           'target_scoped_cleanup_claim_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = now()
   where media.installation_id = p_installation_id
     and media.id = p_media_id
     and media.status in ('deleting', 'delete_failed')
     and media.updated_at < p_retry_before
   returning * into v_media;

  if not found then
    raise exception 'target_scoped_media_not_reclaimable' using errcode = '23503';
  end if;

  return to_jsonb(v_media);
end;
$function$;

create or replace function public.mcp_claim_one_storage_delete_job(
  p_installation_id text,
  p_job_id text,
  p_retry_before timestamptz,
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
  if p_retry_before is null then
    raise exception 'retry_before_required' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(p_context, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_delete_job_claim_context' using errcode = '23514';
  end if;

  update public.mcp_storage_delete_jobs job
     set status = 'finalizing',
         attempt_count = job.attempt_count + 1,
         last_error = null,
         raw_payload = coalesce(job.raw_payload, '{}'::jsonb) || jsonb_build_object(
           'target_scoped_finalize_claim_context', coalesce(p_context, '{}'::jsonb)
         ),
         updated_at = now()
   where job.installation_id = p_installation_id
     and job.id = p_job_id
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
   returning * into v_job;

  if not found then
    raise exception 'target_scoped_delete_job_not_claimable' using errcode = '23503';
  end if;

  return to_jsonb(v_job);
end;
$function$;

revoke all on function public.mcp_f05_archive_proof_capabilities(text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_f05_archive_proof_capabilities(text, jsonb) to service_role;

revoke all on function public.mcp_claim_one_outlet_media_delete(text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_claim_one_outlet_media_delete(text, text, timestamptz, jsonb) to service_role;

revoke all on function public.mcp_claim_one_storage_delete_job(text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_claim_one_storage_delete_job(text, text, timestamptz, jsonb) to service_role;
