-- Allow Next server routes to call controlled MCP RPCs without requiring service-role env in the frontend runtime.
-- Mutations stay inside RPC contracts; tables are not exposed directly by this migration.

alter function public.mcp_create_route(text,text,integer,text,text) security definer;
alter function public.mcp_update_route(text,text,text,integer,text,boolean,text) security definer;
alter function public.mcp_delete_route_hard(text) security definer;
alter function public.mcp_create_route_customer(text,text,text,text,text,integer,text,text,double precision,double precision) security definer;
alter function public.mcp_update_route_customer(text,text,text,text,text,integer,text,boolean,double precision,double precision) security definer;
alter function public.mcp_get_report_templates(text,text,text,text) security definer;
alter function public.mcp_get_report_context(text) security definer;

grant execute on function public.mcp_create_route(text,text,integer,text,text) to anon, authenticated, service_role;
grant execute on function public.mcp_update_route(text,text,text,integer,text,boolean,text) to anon, authenticated, service_role;
grant execute on function public.mcp_delete_route_hard(text) to anon, authenticated, service_role;
grant execute on function public.mcp_create_route_customer(text,text,text,text,text,integer,text,text,double precision,double precision) to anon, authenticated, service_role;
grant execute on function public.mcp_update_route_customer(text,text,text,text,text,integer,text,boolean,double precision,double precision) to anon, authenticated, service_role;
grant execute on function public.mcp_get_report_templates(text,text,text,text) to anon, authenticated, service_role;
grant execute on function public.mcp_get_report_context(text) to anon, authenticated, service_role;
