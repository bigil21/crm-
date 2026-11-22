-- QA issue 9: lead and project numbers carry the date they were reserved
-- (LD-YYYYMMDD-NNNNNN). That date was taken in UTC, so a lead entered on the
-- evening of Nov 21 in Florida was numbered LD-20261122-... and the lead page
-- showed three different dates for one record.
--
-- Number with the company's own calendar day instead. The time zone lives in
-- one function so it can be changed in one place. Existing numbers are not
-- touched. Safe to re-run.
create or replace function public.crm_company_time_zone()
returns text language sql stable set search_path = ''
as $$ select 'America/New_York'::text $$;
revoke all on function public.crm_company_time_zone() from public, anon;
grant execute on function public.crm_company_time_zone() to authenticated;

do $migration$
declare
  proc regprocedure := to_regprocedure('public.crm_reserve_sales_numbers(text,text,text,text)');
  original text;
  def text;
begin
  if proc is null then return; end if;
  original := pg_get_functiondef(proc);
  def := replace(
    original,
    $old$clock_timestamp() at time zone 'UTC','YYYYMMDD'$old$,
    $new$clock_timestamp() at time zone public.crm_company_time_zone(),'YYYYMMDD'$new$
  );
  if def is distinct from original then
    execute def;
  elsif position('public.crm_company_time_zone()' in original) = 0 then
    raise exception 'crm_reserve_sales_numbers no longer matches the definition this migration rewrites';
  end if;
end
$migration$;
