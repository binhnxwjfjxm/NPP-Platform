-- Keep route-customer visit order contiguous and unique for every route.
-- Insert at N shifts N..end down. Moving upward inserts before the current N;
-- moving downward inserts after the current N so the moved customer ends at N.

create or replace function public.mcp_route_customer_order_lock_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if tg_op = 'DELETE' then
    perform pg_advisory_xact_lock(hashtextextended('mcp_route_customer_order:' || old.route_id, 0));
    return old;
  end if;

  if tg_op = 'UPDATE' and old.route_id is distinct from new.route_id then
    perform pg_advisory_xact_lock(hashtextextended('mcp_route_customer_order:' || old.route_id, 0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mcp_route_customer_order:' || new.route_id, 0));
  return new;
end;
$function$;

create or replace function public.mcp_resequence_route_customers(
  p_route_id text,
  p_moved_id text default null,
  p_requested_order integer default null,
  p_move_direction integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_route_id text := nullif(btrim(coalesce(p_route_id, '')), '');
  v_count integer;
  v_target integer;
begin
  if v_route_id is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mcp_route_customer_order:' || v_route_id, 0));

  select count(*)::integer
    into v_count
    from public.mcp_route_customers
   where route_id = v_route_id;

  if v_count = 0 then
    return;
  end if;

  v_target := greatest(1, least(coalesce(nullif(p_requested_order, 0), v_count), v_count));

  with ranked as (
    select
      row.id,
      row_number() over (
        order by
          case
            when row.id = p_moved_id then v_target
            else coalesce(row.sort_order, 2147483647)
          end,
          case
            when row.id = p_moved_id and p_move_direction > 0 then 1
            when row.id = p_moved_id then -1
            when coalesce(row.sort_order, 2147483647) = v_target and p_move_direction > 0 then -1
            when coalesce(row.sort_order, 2147483647) = v_target then 1
            else 0
          end,
          coalesce(row.sort_order, 2147483647),
          row.created_at,
          row.id
      )::integer as next_order
    from public.mcp_route_customers as row
    where row.route_id = v_route_id
  )
  update public.mcp_route_customers as target
     set sort_order = ranked.next_order
    from ranked
   where target.id = ranked.id
     and target.sort_order is distinct from ranked.next_order;
end;
$function$;

create or replace function public.mcp_route_customer_resequence_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_direction integer := 0;
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.mcp_resequence_route_customers(old.route_id, null, null, 0);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.route_id is distinct from new.route_id then
    perform public.mcp_resequence_route_customers(old.route_id, null, null, 0);
  end if;

  if tg_op = 'UPDATE' then
    v_direction := case
      when coalesce(new.sort_order, 0) > coalesce(old.sort_order, 0) then 1
      when coalesce(new.sort_order, 0) < coalesce(old.sort_order, 0) then -1
      else 0
    end;
  end if;

  perform public.mcp_resequence_route_customers(
    new.route_id,
    new.id,
    new.sort_order,
    case when tg_op = 'INSERT' then -1 else v_direction end
  );
  return new;
end;
$function$;

-- Repair every existing route before enforcing the invariant.
do $block$
declare
  route_row record;
begin
  for route_row in
    select distinct route_id
      from public.mcp_route_customers
     where route_id is not null
  loop
    perform public.mcp_resequence_route_customers(route_row.route_id, null, null, 0);
  end loop;
end;
$block$;

drop trigger if exists mcp_route_customers_order_lock on public.mcp_route_customers;
create trigger mcp_route_customers_order_lock
before insert or delete or update of route_id, sort_order
on public.mcp_route_customers
for each row
execute function public.mcp_route_customer_order_lock_trigger();

drop trigger if exists mcp_route_customers_resequence on public.mcp_route_customers;
create trigger mcp_route_customers_resequence
after insert or delete or update of route_id, sort_order
on public.mcp_route_customers
for each row
execute function public.mcp_route_customer_resequence_trigger();

do $block$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.mcp_route_customers'::regclass
       and conname = 'mcp_route_customers_route_sort_order_unique'
  ) then
    alter table public.mcp_route_customers
      add constraint mcp_route_customers_route_sort_order_unique
      unique (route_id, sort_order)
      deferrable initially deferred;
  end if;
end;
$block$;

-- Remove old standalone smoke orders. Route/session fixtures are archived through
-- the guarded cleanup tool because they may own provider media outside Postgres.
with smoke_orders as (
  select id
    from public.orders
   where left(coalesce(note, ''), length('__NPP_F05_RUNTIME_SMOKE__')) = '__NPP_F05_RUNTIME_SMOKE__'
      or left(coalesce(customer_name, ''), length('__NPP_F05_RUNTIME_SMOKE__')) = '__NPP_F05_RUNTIME_SMOKE__'
      or left(coalesce(sales, ''), length('__NPP_F05_RUNTIME_SMOKE__')) = '__NPP_F05_RUNTIME_SMOKE__'
)
delete from public.order_items
 where order_id in (select id from smoke_orders);

delete from public.orders
 where left(coalesce(note, ''), length('__NPP_F05_RUNTIME_SMOKE__')) = '__NPP_F05_RUNTIME_SMOKE__'
    or left(coalesce(customer_name, ''), length('__NPP_F05_RUNTIME_SMOKE__')) = '__NPP_F05_RUNTIME_SMOKE__'
    or left(coalesce(sales, ''), length('__NPP_F05_RUNTIME_SMOKE__')) = '__NPP_F05_RUNTIME_SMOKE__';

revoke all on function public.mcp_route_customer_order_lock_trigger() from public, anon, authenticated;
revoke all on function public.mcp_resequence_route_customers(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.mcp_route_customer_resequence_trigger() from public, anon, authenticated;
grant execute on function public.mcp_resequence_route_customers(text, text, integer, integer) to service_role;

comment on function public.mcp_resequence_route_customers(text, text, integer, integer)
is 'Serializes and normalizes one route customer visit order to a contiguous unique 1..N sequence.';
