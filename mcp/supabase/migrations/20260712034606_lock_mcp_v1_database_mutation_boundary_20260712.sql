-- MCP v1 database boundary:
-- anon/authenticated may keep reads allowed by RLS, but all writes must run
-- through the VPS service role and approved RPC contracts.

do $block$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relname like 'mcp\_%' escape '\'
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on table public.%I from public, anon, authenticated',
      r.table_name
    );
    execute format('grant select on table public.%I to anon, authenticated', r.table_name);
    execute format('grant all privileges on table public.%I to service_role', r.table_name);
  end loop;
end;
$block$;

-- Remove every non-read RLS policy from MCP-owned tables. The service role
-- bypasses RLS; leaving only SELECT policies makes the boundary auditable.
do $block$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename like 'mcp\_%' escape '\'
      and cmd <> 'SELECT'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$block$;

-- Revoke direct RPC access for all MCP mutation functions and trigger/helper
-- functions. Read-only product/report RPCs are intentionally left unchanged.
do $block$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname ~ '^mcp_(create|update|set|delete|open|backfill|import|save|recalc|assert|block|sync|upsert)'
        or p.proname in (
          'mcp_session_customers_require_added_session_context',
          'mcp_visits_set_session_date',
          'mcp_product_variant_normalize_before_write'
        )
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end;
$block$;
