-- Row-level security speed-up. Same rules, evaluated once per query.
--
-- Policies called helper functions such as is_coastal_crest_user() and
-- can_manage_team_crm() directly. Those are SECURITY DEFINER, so Postgres
-- cannot inline them and ran them again for EVERY row: loading the 554 CRM
-- records took ~1.5 s, and startup runs dozens of such reads.
--
-- Wrapping a call that takes no arguments in (select ...) makes Postgres run
-- it once per query and reuse the answer. These helpers depend only on the
-- signed-in user, never on the row, so who can see or change what is unchanged.
-- Already-wrapped calls are left alone; the migration can be re-run safely.
--
-- ALTER POLICY briefly locks each table. Give up quickly instead of making
-- people wait if a save is holding a lock; simply run it again (ideally when
-- nobody is using the CRM).
set lock_timeout = '5s';
do $$
declare
  pol record;
  fn_pattern constant text :=
    '(?<!select )(?<!SELECT )\m((?:public\.)?(?:is_coastal_crest_user|can_manage_team_crm|is_crm_admin|crm_app_role|crm_base_state_id|crm_access_profile)\(\))';
  new_qual text;
  new_check text;
  stmt text;
begin
  for pol in
    select n.nspname as schema_name, c.relname as table_name, p.polname,
           pg_get_expr(p.polqual, p.polrelid) as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  loop
    new_qual := case when pol.qual is null then null
      else regexp_replace(pol.qual, fn_pattern, '(select \1)', 'g') end;
    new_check := case when pol.with_check is null then null
      else regexp_replace(pol.with_check, fn_pattern, '(select \1)', 'g') end;
    if new_qual is not distinct from pol.qual and new_check is not distinct from pol.with_check then
      continue;
    end if;
    stmt := format('alter policy %I on %I.%I', pol.polname, pol.schema_name, pol.table_name);
    if new_qual is not null then stmt := stmt || format(' using (%s)', new_qual); end if;
    if new_check is not null then stmt := stmt || format(' with check (%s)', new_check); end if;
    execute stmt;
  end loop;
end
$$;
reset lock_timeout;
