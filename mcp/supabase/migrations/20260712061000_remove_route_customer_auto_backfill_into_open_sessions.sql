-- MCP v1 snapshot contract: changing route master must never mutate an
-- already-created route session, including an active session whose snapshot
-- was empty at creation time. Session snapshots are created only by
-- mcp_open_route_session when the session row is first inserted.

drop trigger if exists trg_mcp_route_customers_backfill_report_session
on public.mcp_route_customers;

drop function if exists public.mcp_backfill_report_session_on_route_customer_change();
