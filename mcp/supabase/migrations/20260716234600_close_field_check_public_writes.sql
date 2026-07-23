drop policy if exists "anon insert test customer results" on public.test_customer_results;
drop policy if exists "anon update test customer results" on public.test_customer_results;
drop policy if exists "anon insert market reports" on public.market_reports;
drop policy if exists "anon update market reports" on public.market_reports;

revoke insert, update, truncate on table public.test_customer_results from anon, authenticated;
revoke insert, update, truncate on table public.market_reports from anon, authenticated;
