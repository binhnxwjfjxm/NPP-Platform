create or replace function public.mcp_link_archive_intent_from_delete_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_media_count integer := 0;
begin
  if coalesce(new.raw_payload ->> 'archive_media_count', '') !~ '^\d+$' then
    if new.target_type = 'route_customer' then
      select count(*) into v_media_count
        from public.mcp_outlet_media media
       where media.installation_id = new.installation_id
         and media.route_customer_id = new.target_id
         and media.status <> 'deleted';
    elsif new.target_type = 'route' then
      select count(*) into v_media_count
        from public.mcp_outlet_media media
        join public.mcp_route_customers route_customer
          on route_customer.id = media.route_customer_id
       where media.installation_id = new.installation_id
         and route_customer.route_id = new.target_id
         and media.status <> 'deleted';
    end if;

    new.raw_payload := coalesce(new.raw_payload, '{}'::jsonb) || jsonb_build_object(
      'archive_media_count', v_media_count
    );
  end if;

  update public.mcp_archive_intents
     set delete_job_id = new.id,
         status = case when status = 'completed' then 'completed' else 'processing' end,
         last_error = case when status = 'completed' then last_error else null end,
         updated_at = now()
   where installation_id = new.installation_id
     and target_type = new.target_type
     and target_id = new.target_id
     and (delete_job_id is null or delete_job_id = new.id);

  return new;
end;
$function$;

drop trigger if exists mcp_storage_delete_jobs_link_archive_intent
  on public.mcp_storage_delete_jobs;
create trigger mcp_storage_delete_jobs_link_archive_intent
before insert or update of status, target_type, target_id, raw_payload
on public.mcp_storage_delete_jobs
for each row
execute function public.mcp_link_archive_intent_from_delete_job();

create or replace function public.mcp_sync_archive_intent_from_delete_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_intent public.mcp_archive_intents%rowtype;
  v_context jsonb;
  v_media_count integer := 0;
  v_terminal jsonb;
begin
  if new.status not in ('completed', 'failed') then
    return new;
  end if;

  if coalesce(new.raw_payload ->> 'archive_media_count', '') ~ '^\d+$' then
    v_media_count := (new.raw_payload ->> 'archive_media_count')::integer;
  end if;

  for v_intent in
    select intent.*
      from public.mcp_archive_intents intent
     where intent.installation_id = new.installation_id
       and intent.delete_job_id = new.id
       and intent.status <> 'completed'
     for update
  loop
    v_context := coalesce(
      v_intent.raw_payload -> 'latest_request_context',
      v_intent.raw_payload -> 'request_context',
      new.raw_payload -> 'finish_context',
      '{}'::jsonb
    );

    if new.status = 'completed' then
      v_terminal := jsonb_build_object(
        'targetType', new.target_type,
        'targetId', new.target_id,
        'deleteJobId', new.id,
        'deleted', true,
        'deletedMediaCount', v_media_count
      );
      perform public.mcp_finish_archive_intent(
        new.installation_id,
        v_intent.id,
        true,
        200,
        v_terminal,
        null,
        v_context
      );
    else
      perform public.mcp_finish_archive_intent(
        new.installation_id,
        v_intent.id,
        false,
        null,
        null,
        coalesce(new.last_error, 'archive_failed'),
        v_context
      );
    end if;
  end loop;

  return new;
end;
$function$;

drop trigger if exists mcp_storage_delete_jobs_sync_archive_intent
  on public.mcp_storage_delete_jobs;
create trigger mcp_storage_delete_jobs_sync_archive_intent
after update of status, last_error, completed_at
on public.mcp_storage_delete_jobs
for each row
when (old.status is distinct from new.status or old.last_error is distinct from new.last_error)
execute function public.mcp_sync_archive_intent_from_delete_job();

revoke all on function public.mcp_link_archive_intent_from_delete_job()
  from public, anon, authenticated, service_role;
revoke all on function public.mcp_sync_archive_intent_from_delete_job()
  from public, anon, authenticated, service_role;
