-- STAGING ONLY. Not a production migration; do not include in rollout batches.
-- TEMPLATE: replace __STAGING_TEST_USER_ID__ and __STAGING_TEST_EMAIL__ only in
-- a private, Git-ignored copy after approval. Never commit the real identity.
-- Authorized user-created account in project ixksmfiektzsunmmwejz.
-- Exact subject, exact email and Supabase JWT issuer are all required.
begin;
do $$
begin
  if not exists (select 1 from auth.users
    where id = '__STAGING_TEST_USER_ID__'
      and lower(email) = '__STAGING_TEST_EMAIL__'
      and email_confirmed_at is not null) then
    raise exception 'Verified staging test identity missing; no changes applied';
  end if;
  if exists (select 1 from public.crm_admins where lower(email) = '__STAGING_TEST_EMAIL__') then
    raise exception 'Sales tester unexpectedly belongs to admin list; no changes applied';
  end if;
end $$;
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"sales"}'::jsonb
where id = '__STAGING_TEST_USER_ID__' and lower(email) = '__STAGING_TEST_EMAIL__';

create or replace function public.is_coastal_crest_user()
returns boolean language sql stable set search_path = ''
as $$
  select lower(coalesce(auth.jwt()->>'email', '')) like '%@coastalcrestroofing.com'
    or (
      auth.uid() = '__STAGING_TEST_USER_ID__'::uuid
      and lower(coalesce(auth.jwt()->>'email', '')) = '__STAGING_TEST_EMAIL__'
      and auth.jwt()->>'iss' = 'https://ixksmfiektzsunmmwejz.supabase.co/auth/v1'
      and auth.jwt()->'app_metadata'->>'role' = 'sales'
    );
$$;
commit;
