-- Fix archive delete-job linking so the foreign key is written only after the
-- mcp_storage_delete_jobs row exists. The previous BEFORE INSERT trigger tried
-- to point mcp_archive_intents.delete_job_id at NEW.id before PostgreSQL had
-- inserted that job row, causing a 23503 rollback.

create or replace function public.mcp_link_archive_intent_from_delete_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_media_count integer := 0;
begin
  -- BEFORE-row responsibility: enrich the job payload only.
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

  return new;
end;
$function$;

create or replace function public.mcp_link_archive_intent_after_delete_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- AFTER-row responsibility: NEW.id now exists in mcp_storage_delete_jobs,
  -- so assigning the archive-intent foreign key is valid.
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

-- Remove both the canonical name and the one-off singular spelling that may
-- exist on an environment created from an intermediate migration revision.
drop trigger if exists mcp_storage_delete_jobs_link_archive_intent
  on public.mcp_storage_delete_jobs;
drop trigger if exists mcp_storage_delete_job_link_archive_intent
  on public.mcp_storage_delete_jobs;
drop trigger if exists mcp_storage_delete_jobs_prepare_archive_metadata
  on public.mcp_storage_delete_jobs;

create trigger mcp_storage_delete_jobs_prepare_archive_metadata
before insert or update of target_type, target_id, raw_payload
on public.mcp_storage_delete_jobs
for each row
execute function public.mcp_link_archive_intent_from_delete_job();

create trigger mcp_storage_delete_jobs_link_archive_intent
after insert or update
on public.mcp_storage_delete_jobs
for each row
execute function public.mcp_link_archive_intent_after_delete_job();

revoke all on function public.mcp_link_archive_intent_from_delete_job()
  from public, anon, authenticated, service_role;
revoke all on function public.mcp_link_archive_intent_after_delete_job()
  from public, anon, authenticated, service_role;

comment on function public.mcp_link_archive_intent_after_delete_job() is
  'Links archive intents only after the referenced storage delete job row exists.';
