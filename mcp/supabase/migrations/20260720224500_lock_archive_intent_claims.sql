alter function public.mcp_claim_archive_intent(text, text, text, text, text, jsonb, jsonb)
  rename to mcp_claim_archive_intent_unlocked;

revoke all on function public.mcp_claim_archive_intent_unlocked(text, text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.mcp_claim_archive_intent(
  p_installation_id text,
  p_operation text,
  p_idempotency_key text,
  p_target_type text,
  p_target_id text,
  p_request_payload jsonb default '{}'::jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'mcp_archive_intent:key:' || coalesce(p_installation_id, '') || ':' ||
      coalesce(p_operation, '') || ':' || coalesce(p_idempotency_key, ''),
      0
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'mcp_archive_intent:target:' || coalesce(p_installation_id, '') || ':' ||
      coalesce(p_target_type, '') || ':' || coalesce(p_target_id, ''),
      0
    )
  );

  return public.mcp_claim_archive_intent_unlocked(
    p_installation_id,
    p_operation,
    p_idempotency_key,
    p_target_type,
    p_target_id,
    p_request_payload,
    p_context
  );
end;
$function$;

revoke all on function public.mcp_claim_archive_intent(text, text, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.mcp_claim_archive_intent(text, text, text, text, text, jsonb, jsonb)
  to service_role;
